import { useEffect, useRef, useState } from "react";
import { MessageCircle, X, Send, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { requestNotifyPermission, notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function ChatWidget({ companyId, companyName, isOwner, open, setOpen }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [unread, setUnread] = useState(0);
  const prevCompanyMsgs = useRef(0);
  const endRef = useRef();

  const load = async () => {
    if (!user) return;
    try {
      const { data } = await api.get(`/chat/${companyId}/messages`);
      setMessages(data);
      const companyMsgs = data.filter((m) => m.sender === "company");
      if (companyMsgs.length > prevCompanyMsgs.current && prevCompanyMsgs.current > 0) {
        notify("VIVACE — პასუხი კომპანიისგან", `${companyName} გიპასუხათ.`);
      }
      prevCompanyMsgs.current = companyMsgs.length;
      const un = data.filter((m) => m.sender === "company" && !m.read_by_visitor).length;
      setUnread(un);
    } catch (_) {}
  };

  useEffect(() => {
    if (!user || isOwner) return;
    requestNotifyPermission();
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line
  }, [user, companyId, isOwner]);

  useEffect(() => {
    if (!open || !user) return;
    api.post(`/chat/${companyId}/read`).then(() => setUnread(0)).catch(() => {});
    // eslint-disable-next-line
  }, [open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      const { data } = await api.post(`/chat/${companyId}/messages`, { text: text.trim() });
      setMessages((m) => [...m, data]);
      setText("");
    } catch (err) {
      apiError(err);
    } finally {
      setSending(false);
    }
  };

  if (isOwner) return null;

  return (
    <>
      {!open && (
        <button data-testid="open-chat-button" onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 bg-primary hover:bg-orange-600 transition-colors text-primary-foreground rounded-full h-14 w-14 flex items-center justify-center shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
          <MessageCircle className="w-6 h-6" />
          {unread > 0 && (
            <span data-testid="chat-unread-badge"
              className="absolute -top-1 -right-1 min-w-6 h-6 px-1.5 rounded-full bg-destructive text-white text-xs font-bold flex items-center justify-center border-2 border-background">
              {unread}
            </span>
          )}
        </button>
      )}

      {open && (
        <div className="fixed bottom-6 right-6 z-40 w-[92vw] max-w-sm bg-card border border-border rounded-xl shadow-[0_8px_40px_rgba(0,0,0,0.6)] flex flex-col overflow-hidden" style={{ height: "480px" }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/50">
            <div>
              <p className="font-medium text-sm">{companyName}</p>
              <p className="text-xs text-muted-foreground">ჩატი კომპანიასთან</p>
            </div>
            <button data-testid="close-chat-button" onClick={() => setOpen(false)} aria-label="close">
              <X className="w-5 h-5 text-muted-foreground hover:text-foreground" />
            </button>
          </div>

          {!user ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
              <MessageCircle className="w-10 h-10 text-primary" />
              <p className="text-sm text-muted-foreground">კომპანიასთან საუბრისთვის გაიარეთ ავტორიზაცია.</p>
              <Button data-testid="chat-login-button" onClick={() => navigate("/login")}
                className="bg-primary hover:bg-orange-600 transition-colors">ავტორიზაცია</Button>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.length === 0 && (
                  <p className="text-center text-xs text-muted-foreground py-6">
                    დაწერეთ პირველი შეტყობინება
                  </p>
                )}
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.sender === "visitor" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[75%] px-3 py-2 rounded-lg text-sm ${
                      m.sender === "visitor"
                        ? "bg-primary text-primary-foreground rounded-br-none"
                        : "bg-secondary text-foreground rounded-bl-none"
                    }`}>
                      {m.text}
                    </div>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
              <div className="p-3 border-t border-border flex gap-2">
                <Input data-testid="chat-message-input" value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()}
                  placeholder="შეტყობინება..." />
                <Button data-testid="chat-send-button" size="icon" onClick={send} disabled={sending}
                  className="bg-primary hover:bg-orange-600 transition-colors flex-shrink-0">
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
