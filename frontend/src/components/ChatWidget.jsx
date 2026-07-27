import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, X, Send, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { requestNotifyPermission, notify } from "@/lib/notify";
import { formatTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const POLL_OPEN_MS = 4000;
const POLL_CLOSED_MS = 20000;

const mergeMessages = (prev, incoming) => {
  if (!incoming.length) return prev;
  const byId = new Map(prev.map((m) => [m.id, m]));
  let changed = false;
  for (const m of incoming) {
    if (!byId.has(m.id)) changed = true;
    byId.set(m.id, m);
  }
  if (!changed) return prev;
  return [...byId.values()].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
};

export default function ChatWidget({ companyId, companyName, isOwner, open, setOpen }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [unread, setUnread] = useState(0);

  const listRef = useRef(null);
  const endRef = useRef(null);
  const sinceRef = useRef(null);
  const loadedRef = useRef(false);
  const openRef = useRef(open);
  const stoppedRef = useRef(false);

  openRef.current = open;

  // დახურულ ვიჯეტზე მხოლოდ ჩაუკითხავების რაოდენობას ვიღებთ (მსუბუქი count),
  // ღიაზე — მხოლოდ ახალ შეტყობინებებს `since` კურსორით.
  const poll = useCallback(
    async (signal) => {
      if (!user || stoppedRef.current) return;
      try {
        if (!openRef.current && loadedRef.current) {
          const { data } = await api.get(`/chat/${companyId}/unread-count`, { signal });
          setUnread(data?.unread ?? 0);
          return;
        }
        const params = sinceRef.current ? { since: sinceRef.current } : undefined;
        const { data } = await api.get(`/chat/${companyId}/messages`, { params, signal });
        if (!Array.isArray(data)) return;
        loadedRef.current = true;
        if (data.length) {
          sinceRef.current = data[data.length - 1].created_at;
          const fromCompany = data.filter((m) => m.sender_id !== user.id);
          setMessages((prev) => mergeMessages(prev, data));
          if (fromCompany.length && (!openRef.current || document.hidden)) {
            notify("VIVACE — პასუხი კომპანიისგან", `${companyName} გიპასუხათ.`);
            setUnread((n) => n + fromCompany.length);
          }
        }
      } catch (err) {
        if (signal?.aborted || err?.code === "ERR_CANCELED") return;
        // 401/403-ზე polling-ს ვწყვეტთ, რომ უსასრულო მარცხი არ გაგრძელდეს
        if ([401, 403].includes(err?.response?.status)) stoppedRef.current = true;
      }
    },
    [companyId, companyName, user]
  );

  useEffect(() => {
    // კომპანიის/მომხმარებლის შეცვლაზე მდგომარეობის სრული გადატვირთვა
    sinceRef.current = null;
    loadedRef.current = false;
    stoppedRef.current = false;
    setMessages([]);
    setUnread(0);
  }, [companyId, user?.id]);

  useEffect(() => {
    if (!user || isOwner) return;
    requestNotifyPermission();

    let timer = null;
    let controller = null;
    let cancelled = false;

    const tick = async () => {
      if (cancelled || document.hidden) return schedule();
      controller = new AbortController();
      await poll(controller.signal);
      schedule();
    };

    const schedule = () => {
      if (cancelled || stoppedRef.current) return;
      clearTimeout(timer);
      timer = setTimeout(tick, openRef.current ? POLL_OPEN_MS : POLL_CLOSED_MS);
    };

    const onVisible = () => {
      if (!document.hidden) tick();
    };

    tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user, isOwner, poll]);

  useEffect(() => {
    if (!open || !user || isOwner) return;
    api
      .post(`/chat/${companyId}/read`, {})
      .then(() => {
        setUnread(0);
        window.dispatchEvent(new Event("chat-unread-refresh"));
      })
      .catch(() => {});
  }, [open, user, isOwner, companyId, messages.length]);

  useEffect(() => {
    if (!open) return;
    // მხოლოდ ჩატის კონტეინერში ვასქროლავთ — გვერდი ადგილიდან არ წანაცვლდება
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, open]);

  const send = async () => {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    try {
      const { data } = await api.post(`/chat/${companyId}/messages`, { text: value });
      setMessages((prev) => mergeMessages(prev, [data]));
      if (data?.created_at && (!sinceRef.current || data.created_at > sinceRef.current)) {
        sinceRef.current = data.created_at;
      }
      setText("");
    } catch (err) {
      apiError(err);
    } finally {
      setSending(false);
    }
  };

  const rendered = useMemo(
    () =>
      messages.map((m) => {
        const isVisitor = m.sender_id === user?.id;
        return (
          <div key={m.id} className={`flex flex-col ${isVisitor ? "items-end" : "items-start"}`}>
            <div
              className={`max-w-[75%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap break-words ${
                isVisitor
                  ? "bg-primary text-primary-foreground rounded-br-none"
                  : "bg-secondary text-foreground rounded-bl-none"
              }`}
            >
              {m.text}
            </div>
            <span className="text-[10px] text-muted-foreground mt-1 px-1">
              {formatTime(m.created_at)}
            </span>
          </div>
        );
      }),
    [messages, user?.id]
  );

  if (isOwner) return null;

  return (
    <>
      {!open && (
        <button
          data-testid="open-chat-button"
          onClick={() => setOpen(true)}
          aria-label={unread > 0 ? `ჩატი, ${unread} ახალი შეტყობინება` : "ჩატი"}
          className="fixed bottom-6 right-6 z-40 bg-primary hover:bg-orange-600 transition-colors text-primary-foreground rounded-full h-14 w-14 flex items-center justify-center shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        >
          <MessageCircle className="w-6 h-6" />
          {unread > 0 && (
            <span
              data-testid="chat-unread-badge"
              className="absolute -top-1 -right-1 min-w-6 h-6 px-1.5 rounded-full bg-destructive text-white text-xs font-bold flex items-center justify-center border-2 border-background"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label={`ჩატი — ${companyName}`}
          className="fixed bottom-6 right-6 z-40 w-[92vw] max-w-sm bg-card border border-border rounded-xl shadow-[0_8px_40px_rgba(0,0,0,0.6)] flex flex-col overflow-hidden"
          style={{ height: "480px" }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/50">
            <div>
              <p className="font-medium text-sm">{companyName}</p>
              <p className="text-xs text-muted-foreground">ჩატი კომპანიასთან</p>
            </div>
            <button data-testid="close-chat-button" onClick={() => setOpen(false)} aria-label="დახურვა">
              <X className="w-5 h-5 text-muted-foreground hover:text-foreground" />
            </button>
          </div>

          {!user ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-center">
              <MessageCircle className="w-10 h-10 text-primary" />
              <p className="text-sm text-muted-foreground">
                კომპანიასთან საუბრისთვის გაიარეთ ავტორიზაცია.
              </p>
              <Button
                data-testid="chat-login-button"
                onClick={() => navigate("/login")}
                className="bg-primary hover:bg-orange-600 transition-colors"
              >
                ავტორიზაცია
              </Button>
            </div>
          ) : (
            <>
              <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-3" aria-live="polite">
                {messages.length === 0 && (
                  <p className="text-center text-xs text-muted-foreground py-6">
                    დაწერეთ პირველი შეტყობინება
                  </p>
                )}
                {rendered}
                <div ref={endRef} />
              </div>
              <div className="p-3 border-t border-border flex gap-2">
                <Input
                  data-testid="chat-message-input"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
                    e.preventDefault();
                    send();
                  }}
                  maxLength={2000}
                  placeholder="შეტყობინება..."
                />
                <Button
                  data-testid="chat-send-button"
                  size="icon"
                  onClick={send}
                  disabled={sending || !text.trim()}
                  className="bg-primary hover:bg-orange-600 transition-colors flex-shrink-0"
                >
                  {sending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
