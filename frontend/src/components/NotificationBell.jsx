import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import api from "@/lib/api";
 
const POLL_MS = 15000;
const EMPTY = { count: 0, items: [] };
 
export default function NotificationBell() {
  const navigate = useNavigate();
  const [data, setData] = useState(EMPTY);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
 
  const load = useCallback(async (signal) => {
    try {
      // summary აბრუნებს {count, items} — ჩატის ჩაუკითხავები + სისტემური შეტყობინებები
      const { data: res } = await api.get("/notifications/summary", { signal });
      setData({
        count: Number(res?.count) || 0,
        items: Array.isArray(res?.items) ? res.items : [],
      });
    } catch (err) {
      if (signal?.aborted || err?.code === "ERR_CANCELED") return;
      setData(EMPTY);
    }
  }, []);
 
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, POLL_MS);
    const onVisible = () => !document.hidden && load();
    document.addEventListener("visibilitychange", onVisible);
    // ჩატის წაკითხვისთანავე badge განახლდეს (ChatWidget/CompanyInbox აგზავნის ამ event-ს)
    window.addEventListener("chat-unread-refresh", load);
    return () => {
      controller.abort();
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("chat-unread-refresh", load);
    };
  }, [load]);
 
  useEffect(() => {
    const onClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    const onEsc = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, []);
 
  const openMenu = () => {
    setOpen((o) => !o);
    if (!open) load();
  };
 
  return (
    <div className="relative" ref={boxRef}>
      <button
        data-testid="notification-bell"
        onClick={openMenu}
        aria-label={data.count > 0 ? `${data.count} ახალი შეტყობინება` : "შეტყობინებები"}
        aria-expanded={open}
        className="relative h-9 w-9 rounded-full hover:bg-secondary flex items-center justify-center transition-colors"
      >
        <Bell className="w-5 h-5" />
        {data.count > 0 && (
          <span
            data-testid="notification-count"
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-background"
          >
            {data.count > 99 ? "99+" : data.count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-popover border border-border rounded-xl shadow-2xl overflow-hidden z-50">
          <div className="px-4 py-3 border-b border-border font-medium text-sm">შეტყობინებები</div>
          {data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground p-6 text-center">ახალი შეტყობინება არ არის</p>
          ) : (
            <div className="max-h-80 overflow-y-auto divide-y divide-border">
              {data.items.map((it, i) => (
                <button
                  key={`${it.type}-${it.created_at}-${i}`}
                  data-testid="notification-item"
                  onClick={() => {
                    setOpen(false);
                    if (it.link) navigate(it.link);
                  }}
                  className="w-full text-left px-4 py-3 hover:bg-secondary transition-colors flex items-start gap-2"
                >
                  <span
                    className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${
                      it.count > 0 ? "bg-red-500" : "bg-muted-foreground/50"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{it.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{it.subtitle}</p>
                  </div>
                  {it.count > 0 && (
                    <span className="text-xs text-red-500 font-semibold">{it.count}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
