import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Headset, X, Send, Loader2 } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { formatTime } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function SupportChat() {
  const { user } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [unread, setUnread] = useState(0);
  const endRef = useRef();

  const load = async () => {
    try {
      const { data } = await api.get("/support/messages");
      setMessages(data);
      if (!open) setUnread(data.filter((m) => m.sender === "admin" && !m.read_by_user).length);
    } catch (_) {}
  };

  useEffect(() => {
    if (!user || user.role === "admin") return;
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, [user, open]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => { if (open) setUnread(0); }, [open]);

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      const { data } = await api.post("/support/messages", { text: text.trim() });
      setMessages((m) => [...m, data]);
      setText("");
    } finally {
      setSending(false);
    }
  };

  if (!user || user.role === "admin") return null;
  if (location.pathname.startsWith("/verify-email")) return null;

  return (
    <>
      {!open && (
        <button data-testid="support-open-button" onClick={() => setOpen(true)}
          className="fixed bottom-6 left-6 z-40 bg-secondary border border-border hover:border-primary text-foreground rounded-full h-13 w-13 p-3.5 flex items-center justify-center shadow-lg transition-colors">
          <Headset className="w-6 h-6 text-primary" />
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-background">{unread}</span>
          )}
        </button>
      )}
      {open && (
        <div className="fixed bottom-6 left-6 z-40 w-[92vw] max-w-sm bg-card border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden" style={{ height: "460px" }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/50">
            <div className="flex items-center gap-2">
              <Headset className="w-4 h-4 text-primary" />
              <div>
                <p className="font-medium text-sm">ადმინისტრაცია</p>
                <p className="text-xs text-muted-foreground">დახმარება / კითხვები</p>
              </div>
            </div>
            <button data-testid="support-close-button" onClick={() => setOpen(false)} aria-label="close">
              <X className="w-5 h-5 text-muted-foreground hover:text-foreground" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && <p className="text-center text-xs text-muted-foreground py-6">დაგვიკავშირდით — გიპასუხებთ</p>}
            {messages.map((m) => (
              <div key={m.id} className={`flex flex-col ${m.sender === "user" ? "items-end" : "items-start"}`}>
                <div className={`max-w-[75%] px-3 py-2 rounded-lg text-sm ${m.sender === "user" ? "bg-primary text-primary-foreground rounded-br-none" : "bg-secondary text-foreground rounded-bl-none"}`}>{m.text}</div>
                <span className="text-[10px] text-muted-foreground mt-1 px-1">{formatTime(m.created_at)}</span>
              </div>
            ))}
            <div ref={endRef} />
          </div>
          <div className="p-3 border-t border-border flex gap-2">
            <Input data-testid="support-message-input" value={text} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()} placeholder="შეტყობინება..." />
            <Button data-testid="support-send-button" size="icon" onClick={send} disabled={sending}
              className="bg-primary hover:bg-orange-600 transition-colors flex-shrink-0">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
