import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Loader2, ArrowLeft, Headset } from "lucide-react";
import api from "@/lib/api";
import { formatTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function AdminSupport() {
  const [convos, setConvos] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);

  const loadInbox = useCallback(async () => {
    try {
      const { data } = await api.get("/support/inbox");
      const list = Array.isArray(data) ? data : [];

      const grouped = Object.values(
        list.reduce((acc, item) => {
          const uid = item.user_id;
          if (!uid) return acc;

          if (!acc[uid]) {
            acc[uid] = {
              ...item,
              unread: item.sender === "user" ? 1 : 0,
            };
          } else {
            if ((item.created_at || "") > (acc[uid].created_at || "")) {
              acc[uid] = {
                ...acc[uid],
                ...item,
                unread: acc[uid].unread,
              };
            }
            if (item.sender === "user") {
              acc[uid].unread += 1;
            }
          }

          return acc;
        }, {})
      ).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

      setConvos(grouped);
    } catch (_) {}
  }, []);

  const loadMsgs = useCallback(async (uid) => {
    if (!uid) return;
    try {
      const { data } = await api.get(`/support/inbox/${uid}`);
      setMessages(Array.isArray(data) ? data : []);
    } catch (_) {}
  }, []);

  useEffect(() => {
    loadInbox();
    const t = setInterval(loadInbox, 6000);
    return () => clearInterval(t);
  }, [loadInbox]);

  useEffect(() => {
    if (!active?.user_id) return;
    loadMsgs(active.user_id);
    const t = setInterval(() => loadMsgs(active.user_id), 4000);
    return () => clearInterval(t);
  }, [active, loadMsgs]);

  useEffect(() => {
    if (!active?.user_id) return;
    setConvos((prev) =>
      prev.map((c) =>
        c.user_id === active.user_id ? { ...c, unread: 0 } : c
      )
    );
  }, [active]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    if (!text.trim() || !active?.user_id) return;
    setSending(true);
    try {
      const { data } = await api.post(`/support/inbox/${active.user_id}`, {
        text: text.trim(),
      });

      if (data && !data.error) {
        setMessages((m) => [...m, data]);
        setConvos((prev) =>
          prev.map((c) =>
            c.user_id === active.user_id ? { ...c, text: data.text, created_at: data.created_at } : c
          )
        );
        setText("");
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden grid grid-cols-1 md:grid-cols-3" style={{ minHeight: "520px" }}>
      <div className={`border-r border-border ${active ? "hidden md:block" : "block"}`}>
        <div className="px-4 py-3 border-b border-border font-medium flex items-center gap-2">
          <Headset className="w-4 h-4 text-primary" /> მიმართვები
        </div>

        {convos.length === 0 ? (
          <p className="text-sm text-muted-foreground p-6 text-center">ცარიელია</p>
        ) : (
          <div className="divide-y divide-border">
            {convos.map((c) => {
              const uid = c.user_id;
              return (
                <button
                  key={uid}
                  data-testid="support-inbox-item"
                  onClick={() => setActive(c)}
                  className={`w-full text-left px-4 py-3 hover:bg-secondary transition-colors flex items-center gap-2 ${active?.user_id === uid ? "bg-secondary" : ""}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{c.user_name || "მომხმარებელი"}</p>
                    <p className="text-xs text-muted-foreground truncate">{c.text}</p>
                  </div>
                  {c.unread > 0 && (
                    <span className="min-w-5 h-5 px-1.5 rounded-full bg-red-500 text-white text-xs font-semibold flex items-center justify-center">
                      {c.unread}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className={`md:col-span-2 flex flex-col ${active ? "flex" : "hidden md:flex"}`}>
        {!active ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            აირჩიეთ მიმართვა
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <button className="md:hidden" onClick={() => setActive(null)}>
                <ArrowLeft className="w-4 h-4" />
              </button>
              <p className="font-medium text-sm">{active.user_name}</p>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map((m) => {
                const isAdminMsg = m.sender === "admin";
                return (
                  <div key={m.id || Math.random()} className={`flex flex-col ${isAdminMsg ? "items-end" : "items-start"}`}>
                    <div className={`max-w-[70%] px-3 py-2 rounded-lg text-sm ${isAdminMsg ? "bg-primary text-primary-foreground rounded-br-none" : "bg-secondary rounded-bl-none"}`}>
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
                data-testid="support-reply-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="პასუხი..."
              />
              <Button
                data-testid="support-reply-send"
                size="icon"
                onClick={send}
                disabled={sending}
                className="bg-primary hover:bg-orange-600 flex-shrink-0"
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
