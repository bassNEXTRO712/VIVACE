import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Send, Loader2 } from "lucide-react";
import api, { apiError, fileUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function PhotoDialog({ companyId, media, onClose }) {
  const { user } = useAuth();
  const [comments, setComments] = useState([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!media) return;
    api.get(`/company/${companyId}/media/${media.id}/comments`).then((r) => setComments(r.data)).catch(() => {});
  }, [media, companyId]);

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      const { data } = await api.post(`/company/${companyId}/media/${media.id}/comments`, { text: text.trim() });
      setComments((c) => [...c, data]);
      setText("");
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={!!media} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-card border-border max-w-4xl p-0 overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-2">
          <div className="bg-black flex items-center justify-center max-h-[70vh]">
            {media?.type === "video" ? (
              <video src={fileUrl(media?.url)} className="w-full max-h-[70vh] object-contain" controls />
            ) : (
              <img src={fileUrl(media?.url)} alt="" className="w-full max-h-[70vh] object-contain" />
            )}
          </div>
          <div className="flex flex-col max-h-[70vh]">
            <div className="px-4 py-3 border-b border-border font-medium text-sm">კომენტარები ({comments.length})</div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[200px]">
              {comments.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">ჯერ არ არის კომენტარი</p>
              ) : comments.map((c) => (
                <div key={c.id} data-testid="photo-comment" className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs font-semibold uppercase flex-shrink-0 overflow-hidden">
                    {c.avatar_url ? <img src={fileUrl(c.avatar_url)} alt="" className="w-full h-full object-cover" /> : (c.user_name || "?").charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{c.user_name}</p>
                    <p className="text-sm text-muted-foreground">{c.text}</p>
                  </div>
                </div>
              ))}
            </div>
            {user ? (
              <div className="p-3 border-t border-border flex gap-2">
                <Input data-testid="photo-comment-input" value={text} onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()} placeholder="დაწერე კომენტარი..." />
                <Button data-testid="photo-comment-send" size="icon" onClick={send} disabled={sending}
                  className="bg-primary hover:bg-orange-600 transition-colors flex-shrink-0">
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </div>
            ) : (
              <div className="p-3 border-t border-border text-center text-xs text-muted-foreground">
                კომენტარისთვის გაიარეთ ავტორიზაცია
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
