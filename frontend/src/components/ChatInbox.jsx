import { useEffect, useRef, useState } from "react";
import { MessageSquare, Send, Loader2, ArrowLeft } from "lucide-react";
import api from "@/lib/api";
import { formatTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function ChatInbox() {
  const [convos, setConvos] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const lastTypingSent = useRef(0);
  const endRef = useRef(null);

  const loadInbox = async () => {
    try {
      const { data } = await api.get("/chat/threads");
      setConvos(Array.isArray(data) ? data : []);
    } catch (_) {
      setConvos([]);
    } finally {
      setLoading(false);
    }
  };

  const loadMessages = async (peerId) => {
    if (!peerId) return;

    try {
      const { data } = await api.get(`/chat/messages/${peerId}`);
      setMessages(Array.isArray(data) ? data : []);
      setPeerTyping(false);
    } catch (_) {}
  };

  const onType = (v) => {
    setText(v);

    const now = Date.now();
    if (!active?.peer_id) return;

    if (now - lastTypingSent.current > 2500) {
      lastTypingSent.current = now;
      api.post("/chat/typing").catch(() => {});
    }
  };

  useEffect(() => {
    loadInbox();
    const t = setInterval(loadInbox, 6000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!active?.peer_id) return;

    loadMessages(active.peer_id);
    const t = setInterval(() => loadMessages(active.peer_id), 4000);
    return () => clearInterval(t);
  }, [active]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    if (!text.trim() || !active?.peer_id) return;

    setSending(true);
    try {
      const { data } = await api.post("/chat/messages", {
        text: text.trim(),
        recipient_id: active.peer_id,
        company_id: active.company_id || null,
      });

      if (data) {
        setMessages((m) => [...m, data]);
        setText("");
        setPeerTyping(false);
      }
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div
      className="bg-card border border-border rounded-lg overflow-hidden grid grid-cols-1 md:grid-cols-3"
      style={{ minHeight: "520px" }}
    >
      <div className={`border-r border-border ${active ? "hidden md:block" : "block"}`}>
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-medium flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-primary" /> შეტყობინებები
          </h3>
        </div>

        {convos.length === 0 ? (
          <p className="text-sm text-muted-foreground p-6 text-center">
            ჯერ არ არის შეტყობინებები
          </p>
        ) : (
          <div className="divide-y divide-border">
            {convos.map((c) => (
              <button
                key={c.peer_id}
                data-testid="inbox-conversation"
                onClick={() => setActive(c)}
                className={`w-full text-left px-4 py-3 hover:bg-secondary transition-colors flex items-center gap-2 ${
                  active?.peer_id === c.peer_id ? "bg-secondary" : ""
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">
                    {c.peer_name || "მომხმარებელი"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {c.last_text}
                  </p>
                </div>

                {c.unread > 0 && (
                  <span
                    data-testid="conversation-unread-badge"
                    className="min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center flex-shrink-0"
                  >
                    {c.unread}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={`md:col-span-2 flex flex-col ${active ? "flex" : "hidden md:flex"}`}>
        {!active ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            აირჩიეთ საუბარი
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <button className="md:hidden" onClick={() => setActive(null)} aria-label="back">
                <ArrowLeft className="w-4 h-4" />
              </button>
              <p className="font-medium text-sm">{active.peer_name || "მომხმარებელი"}</p>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map((m) => {
                const isMe = m.sender_id !== active.peer_id;

                return (
                  <div
                    key={m.id}
                    className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
                  >
                    <div
                      className={`max-w-[70%] px-3 py-2 rounded-lg text-sm ${
                        isMe
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
              })}

              {peerTyping && (
                <div className="flex justify-start">
                  <div
                    className="bg-secondary text-muted-foreground rounded-lg rounded-bl-none px-3 py-2 text-xs"
                    data-testid="typing-indicator"
                  >
                    წერს...
                  </div>
                </div>
              )}

              <div ref={endRef} />
            </div>

            <div className="p-3 border-t border-border flex gap-2">
              <Input
                data-testid="inbox-message-input"
                value={text}
                onChange={(e) => onType(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="პასუხის დაწერა..."
              />
              <Button
                data-testid="inbox-send-button"
                size="icon"
                onClick={send}
                disabled={sending}
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
    </div>
  );
}
