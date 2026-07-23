import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import api from "@/lib/api";

export default function NotificationBell() {
  const navigate = useNavigate();
  const [data, setData] = useState({ count: 0, items: [] });
  const [open, setOpen] = useState(false);
  const boxRef = useRef();

  useEffect(() => {
    const load = () => api.get("/notifications").then((r) => setData(r.data || { count: 0, items: [] })).catch(() => {});
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onClick = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="relative" ref={boxRef}>
      <button data-testid="notification-bell" onClick={() => setOpen((o) => !o)}
        className="relative h-9 w-9 rounded-full hover:bg-secondary flex items-center justify-center transition-colors">
        <Bell className="w-5 h-5" />
        {data.count > 0 && (
          <span data-testid="notification-count"
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-background">
            {data.count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-popover border border-border rounded-xl shadow-2xl overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-border font-medium text-sm">შეტყობინებები</div>
          {!data.items || data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground p-6 text-center">ახალი შეტყობინება არ არის</p>
          ) : (
            <div className="max-h-80 overflow-y-auto divide-y divide-border">
              {data.items.map((it, i) => (
                <button key={i} data-testid="notification-item"
                  onClick={() => { setOpen(false); if (it.link) navigate(it.link); }}
                  className="w-full text-left px-4 py-3 hover:bg-secondary transition-colors flex items-start gap-2">
                  <span className="mt-1 w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{it.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{it.subtitle}</p>
                  </div>
                  {it.count > 0 && <span className="text-xs text-red-500 font-semibold">{it.count}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
