import { useEffect, useRef, useState } from "react";
import { MessageSquare, Send, Loader2, ArrowLeft } from "lucide-react";
import api from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function ChatInbox() {
  const [convos, setConvos] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const endRef = useRef();

  const loadInbox = async () => {
    try {
      const { data } = await api.get("/chat/inbox");
      setConvos(data);
    } finally {
      setLoading(false);
    }
  };

  const loadMessages = async (visitorId) => {
    try {
      const { data } = await api.get(`/chat/inbox/${visitorId}/messages`);
      setMessages(data);
    } catch (_) {}
  };

  useEffect(() => {
    loadInbox();
    const t = setInterval(loadInbox, 6000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!active) return;
    loadMessages(active.visitor_id);
    const t = setInterval(() => loadMessages(active.visitor_id), 4000);
    return () => clearInterval(t);
  }, [active]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    if (!text.trim() || !active) return;
    setSending(true);
    try {
      const { data } = await api.post(`/chat/inbox/${active.visitor_id}/messages`, { text: text.trim() });
      setMessages((m) => [...m, data]);
      setText("");
    } finally {
      setSending(false);
    }
  };

  if (loading)
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden grid grid-cols-1 md:grid-cols-3" style={{ minHeight: "520px" }}>
      {/* Conversation list */}
      <div className={`border-r border-border ${active ? "hidden md:block" : "block"}`}>
        <div className="px-4 py-3 border-b border-border">
          <h3 className="font-medium flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-primary" /> შეტყობინებები
          </h3>
        </div>
        {convos.length === 0 ? (
          <p className="text-sm text-muted-foreground p-6 text-center">ჯერ არ არის შეტყობინებები</p>
        ) : (
          <div className="divide-y divide-border">
            {convos.map((c) => (
              <button key={c.visitor_id} data-testid="inbox-conversation"
                onClick={() => setActive(c)}
                className={`w-full text-left px-4 py-3 hover:bg-secondary transition-colors ${
                  active?.visitor_id === c.visitor_id ? "bg-secondary" : ""
                }`}>
                <p className="font-medium text-sm truncate">{c.visitor_name}</p>
                <p className="text-xs text-muted-foreground truncate">{c.last_text}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Thread */}
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
              <p className="font-medium text-sm">{active.visitor_name}</p>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map((m) => (
                <div key={m.id} className={`flex ${m.sender === "company" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[70%] px-3 py-2 rounded-lg text-sm ${
                    m.sender === "company"
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
              <Input data-testid="inbox-message-input" value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="პასუხის დაწერა..." />
              <Button data-testid="inbox-send-button" size="icon" onClick={send} disabled={sending}
                className="bg-primary hover:bg-orange-600 transition-colors flex-shrink-0">
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
