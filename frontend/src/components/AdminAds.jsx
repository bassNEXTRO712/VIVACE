import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Trash2, Plus, Video, ImageIcon } from "lucide-react";
import api, { apiError, fileUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function AdminAds() {
  const [ads, setAds] = useState([]);
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");
  const [media, setMedia] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef();

  const load = async () => { try { const { data } = await api.get("/admin/ads"); setAds(data); } catch (_) {} };
  useEffect(() => { load(); }, []);

  const upload = async (file) => {
    if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    setUploading(true);
    try { const { data } = await api.post("/upload", fd); setMedia(data); }
    catch (err) { toast.error(apiError(err)); }
    finally { setUploading(false); }
  };

  const create = async () => {
    if (!media) { toast.error("ატვირთეთ ფოტო ან ვიდეო"); return; }
    setSaving(true);
    try {
      await api.post("/admin/ads", { title, link, media_url: media.url, media_type: media.type });
      setTitle(""); setLink(""); setMedia(null); toast.success("რეკლამა დაემატა"); load();
    } catch (err) { toast.error(apiError(err)); }
    finally { setSaving(false); }
  };

  const del = async (id) => { try { await api.delete(`/admin/ads/${id}`); load(); } catch (_) {} };

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h3 className="font-medium">ახალი რეკლამა</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input data-testid="ad-title-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="სათაური" />
          <Input data-testid="ad-link-input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="ბმული (არასავალდებულო)" />
        </div>
        <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={(e) => upload(e.target.files[0])} />
        <div className="flex items-center gap-3">
          <Button data-testid="ad-upload-button" variant="outline" className="border-border" onClick={() => fileRef.current.click()} disabled={uploading}>
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4 mr-1" /> მედია</>}
          </Button>
          {media && (media.type === "video"
            ? <video src={fileUrl(media.url)} className="h-14 rounded border border-border" />
            : <img src={fileUrl(media.url)} alt="" className="h-14 rounded border border-border" />)}
        </div>
        <Button data-testid="ad-create-button" onClick={create} disabled={saving} className="bg-primary hover:bg-orange-600">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "დამატება"}
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {ads.map((a) => (
          <div key={a.id} data-testid="admin-ad-item" className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="h-36 bg-secondary">
              {a.media_type === "video"
                ? <video src={fileUrl(a.media_url)} className="w-full h-full object-cover" />
                : <img src={fileUrl(a.media_url)} alt="" className="w-full h-full object-cover" />}
            </div>
            <div className="p-3 flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate flex items-center gap-1">
                  {a.media_type === "video" ? <Video className="w-3 h-3" /> : <ImageIcon className="w-3 h-3" />} {a.title || "რეკლამა"}
                </p>
              </div>
              <Button data-testid="admin-ad-delete" size="icon" variant="destructive" className="h-8 w-8 bg-destructive hover:bg-red-700" onClick={() => del(a.id)}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
