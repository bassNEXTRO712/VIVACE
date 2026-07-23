import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Send, Loader2, Smile, ImagePlus, X } from "lucide-react";
import api, { apiError, fileUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const EMOJIS = ["😀", "😍", "🔥", "👍", "❤️", "🎉", "😮", "🙏", "✈️", "🌍", "⭐", "😢"];

export default function PhotoDialog({ companyId, media, onClose }) {
  const { user } = useAuth();
  const [comments, setComments] = useState([]);
  const [text, setText] = useState("");
  const [image, setImage] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const fileRef = useRef();

  useEffect(() => {
    if (!media) return;
    setComments([]); setText(""); setImage("");
    api.get(`/company/${companyId}/media/${media.id}/comments`)
      .then((r) => setComments(r.data || []))
      .catch(() => {});
  }, [media, companyId]);

  const uploadImage = async (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    setUploading(true);
    try {
      const { data } = await api.post("/upload", fd);
      if (data && data.url) {
        setImage(data.url);
      }
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setUploading(false);
    }
  };

  const send = async () => {
    if (!text.trim() && !image) return;
    setSending(true);
    try {
      const { data } = await api.post(`/company/${companyId}/media/${media.id}/comments`, { 
        text: text.trim(), 
        image_url: image 
      });
      if (data) {
        setComments((c) => [...c, data]);
        setText(""); 
        setImage(""); 
        setShowEmoji(false);
      }
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={!!media} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-card border-border max-w-4xl p-0 overflow-hidden">
        <DialogTitle className="sr-only">ფოტო და კომენტარები</DialogTitle>
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
                <div key={c.id || Math.random()} data-testid="photo-comment" className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs font-semibold uppercase flex-shrink-0 overflow-hidden">
                    {c.avatar_url ? <img src={fileUrl(c.avatar_url)} alt="" className="w-full h-full object-cover" /> : (c.user_name || "?").charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{c.user_name}</p>
                    {c.text && <p className="text-sm text-muted-foreground">{c.text}</p>}
                    {c.image_url && (
                      <img src={fileUrl(c.image_url)} alt="" className="mt-2 rounded-lg max-h-40 border border-border" />
                    )}
                  </div>
                </div>
              ))}
            </div>
            {user ? (
              <div className="border-t border-border p-3 space-y-2">
                {image && (
                  <div className="relative inline-block">
                    <img src={fileUrl(image)} alt="" className="h-16 rounded border border-border" />
                    <button onClick={() => setImage("")} className="absolute -top-2 -right-2 bg-black/70 rounded-full p-0.5">
                      <X className="w-3 h-3 text-white" />
                    </button>
                  </div>
                )}
                {showEmoji && (
                  <div className="flex flex-wrap gap-1 bg-secondary/50 rounded-lg p-2" data-testid="emoji-picker">
                    {EMOJIS.map((e) => (
                      <button key={e} data-testid="emoji-option" onClick={() => setText((t) => t + e)}
                        className="text-xl hover:scale-125 transition-transform">{e}</button>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 items-center">
                  <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => uploadImage(e.target.files[0])} />
                  <button data-testid="comment-emoji-button" onClick={() => setShowEmoji((s) => !s)}
                    className="text-muted-foreground hover:text-primary flex-shrink-0"><Smile className="w-5 h-5" /></button>
                  <button data-testid="comment-image-button" onClick={() => fileRef.current.click()} disabled={uploading}
                    className="text-muted-foreground hover:text-primary flex-shrink-0">
                    {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImagePlus className="w-5 h-5" />}
                  </button>
                  <Input data-testid="photo-comment-input" value={text} onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && send()} placeholder="დაწერე კომენტარი..." />
                  <Button data-testid="photo-comment-send" size="icon" onClick={send} disabled={sending}
                    className="bg-primary hover:bg-orange-600 transition-colors flex-shrink-0">
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </Button>
                </div>
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
