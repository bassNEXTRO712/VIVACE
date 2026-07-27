import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, Send, Loader2, ArrowLeft } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { formatTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const POLL_LIST_MS = 8000;
const POLL_THREAD_MS = 4000;

/**
 * ერთი მწკრივი = ერთი საუბარი (და არა ცალკეული შეტყობინება).
 * მონაცემები მოდის `GET /chat/threads`-იდან, სადაც სახელი/ავატარი
 * მომხმარებლის ანგარიშიდან ამოღებულია და `unread` თითო საუბარზეა.
 */
export default function ChatInbox() {
  const { user } = useAuth();
  const [threads, setThreads] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const activeRef = useRef(null);
  const endRef = useRef(null);
  activeRef.current = activeId;

  const loadThreads = useCallback(async (signal) => {
    try {
      const { data } = await api.get("/chat/threads", { signal });
      setThreads(Array.isArray(data) ? data : []);
    } catch (err) {
      if (signal?.aborted || err?.code === "ERR_CANCELED") return;
      setThreads([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async (peerId, signal) => {
    if (!peerId) return;
    try {
      const { data } = await api.get(`/chat/messages/${peerId}`, { signal });
      setMessages(Array.isArray(data) ? data : []);
    } catch (err) {
      if (signal?.aborted || err?.code === "ERR_CANCELED") return;
      setMessages([]);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadThreads(controller.signal);
    const t = setInterval(() => {
      if (!document.hidden) loadThreads();
    }, POLL_LIST_MS);
    return () => {
      controller.abort();
      clearInterval(t);
    };
  }, [loadThreads]);

  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    loadMessages(activeId, controller.signal);
    const t = setInterval(() => {
      if (!document.hidden) loadMessages(activeRef.current);
    }, POLL_THREAD_MS);
    return () => {
      controller.abort();
      clearInterval(t);
    };
  }, [activeId, loadMessages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  const openThread = async (peerId) => {
    setActiveId(peerId);
    setMessages([]);
    // ბეიჯი მაშინვე ქრება, ზარის ღილაკიც განახლდება
    setThreads((prev) => prev.map((t) => (t.peer_id === peerId ? { ...t, unread: 0 } : t)));
    try {
      await api.post("/chat/read", { sender_id: peerId });
      window.dispatchEvent(new Event("chat-unread-refresh"));
    } catch (_) {}
  };

  const send = async () => {
    const value = text.trim();
    if (!value || !activeId || sending) return;
    setSending(true);
    try {
      const active = threads.find((t) => t.peer_id === activeId);
      const { data } = await api.post("/chat/messages", {
        recipient_id: activeId,
        company_id: active?.company_id || undefined,
        text: value,
      });
      if (data) {
        setMessages((prev) => [...prev.filter((m) => m.id !== data.id), data]);
        setText("");
        loadThreads();
      }
    } catch (_) {
    } finally {
      setSending(false);
    }
  };

  const active = threads.find((t) => t.peer_id === activeId);

  if (loading)
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden grid grid-cols-1 md:grid-cols-3" style={{ minHeight: "520px" }}>
      {/* Conversation list */}
      <div className={`border-r border-border ${activeId ? "hidden md:block" : "block"}`}>
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-medium flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-primary" /> შეტყობინებები
          </h3>
        </div>
        {threads.length === 0 ? (
          <p className="text-sm text-muted-foreground p-6 text-center">ჯერ არ არის შეტყობინებები</p>
        ) : (
          <div className="divide-y divide-border max-h-[520px] overflow-y-auto">
            {threads.map((t) => (
              <button
                key={t.peer_id}
                data-testid="inbox-conversation"
                onClick={() => openThread(t.peer_id)}
                className={`w-full text-left px-4 py-3 hover:bg-secondary transition-colors flex items-center gap-3 ${
                  activeId === t.peer_id ? "bg-secondary" : ""
                }`}
              >
                {t.peer_avatar ? (
                  <img src={t.peer_avatar} alt="" loading="lazy" className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-xs flex-shrink-0">
                    {(t.peer_name || "?").slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{t.peer_name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {t.last_from_me ? "თქვენ: " : ""}
                    {t.last_text}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className="text-[10px] text-muted-foreground">{formatTime(t.last_at)}</span>
                  {t.unread > 0 && (
                    <span
                      data-testid="conversation-unread-badge"
                      className="min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center"
                    >
                      {t.unread > 99 ? "99+" : t.unread}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Thread */}
      <div className={`md:col-span-2 flex flex-col ${activeId ? "flex" : "hidden md:flex"}`}>
        {!activeId ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            აირჩიეთ საუბარი
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <button className="md:hidden" onClick={() => setActiveId(null)} aria-label="back">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">{active?.peer_name || "მომხმარებელი"}</p>
                {active?.peer_email && (
                  <p className="text-xs text-muted-foreground truncate">{active.peer_email}</p>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3" aria-live="polite">
              {messages.length === 0 && (
                <p className="text-center text-xs text-muted-foreground py-6">შეტყობინებები არ არის</p>
              )}
              {messages.map((m, i) => {
                const isCompany = m.sender_id === user?.id;
                return (
                  <div key={m.id || i} className={`flex flex-col ${isCompany ? "items-end" : "items-start"}`}>
                    <div
                      className={`max-w-[70%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap break-words ${
                        isCompany
                          ? "bg-primary text-primary-foreground rounded-br-none"
                          : "bg-secondary text-foreground rounded-bl-none"
                      }`}
                    >
                      {m.text}
                    </div>
                    <span className="text-[10px] text-muted-foreground mt-1 px-1">{formatTime(m.created_at)}</span>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>

            <div className="p-3 border-t border-border flex gap-2">
              <Input
                data-testid="inbox-message-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
                  e.preventDefault();
                  send();
                }}
                maxLength={2000}
                placeholder="პასუხის დაწერა..."
              />
              <Button
                data-testid="inbox-send-button"
                size="icon"
                onClick={send}
                disabled={sending || !text.trim()}
                className="bg-primary hover:bg-orange-600 transition-colors flex-shrink-0"
              >
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
