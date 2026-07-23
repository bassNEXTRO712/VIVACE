import { useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Camera } from "lucide-react";
import api, { apiError, fileUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function UserProfile() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const avatarRef = useRef();

  const uploadAvatar = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      // 1. ჯერ ფაილი ავტვირთოთ /upload-ში
      const fd = new FormData();
      fd.append("file", file);
      const { data: uploadData } = await api.post("/upload", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      if (!uploadData?.url) throw new Error("upload failed");

      // 2. შემდეგ url-ი JSON-ით /account/avatar-ში
      const { data } = await api.post(
        "/account/avatar",
        { avatar_url: uploadData.url },
        { headers: { "Content-Type": "application/json" } }
      );
      setUser((u) => ({ ...u, avatar_url: data.avatar_url || uploadData.url }));
      toast.success("ფოტო განახლდა");
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put("/auth/profile", { name });
      setUser(data);
      toast.success("პროფილი შენახულია");
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <div className="bg-card border border-border rounded-lg p-6 md:p-8 space-y-6">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="w-20 h-20 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-2xl font-semibold uppercase overflow-hidden">
              {user?.avatar_url ? (
                <img src={fileUrl(user.avatar_url)} alt="" className="w-full h-full object-cover" />
              ) : (
                (user?.name || user?.email || "?").charAt(0)
              )}
            </div>
            <input ref={avatarRef} type="file" accept="image/*" hidden
              onChange={(e) => uploadAvatar(e.target.files[0])} />
            <button data-testid="upload-avatar-button" onClick={() => avatarRef.current.click()}
              disabled={uploading} aria-label="change photo"
              className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-secondary border border-border flex items-center justify-center hover:bg-primary hover:text-primary-foreground transition-colors">
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
            </button>
          </div>
          <div>
            <h2 className="text-xl font-semibold">{user?.name}</h2>
            <p className="text-sm text-muted-foreground">{user?.email}</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="uname">სახელი</Label>
          <Input id="uname" data-testid="user-name-input" value={name}
            onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>ტელეფონი</Label>
          <Input value={user?.phone || "—"} disabled className="opacity-70" />
          <p className="text-xs text-muted-foreground">ტელეფონი შეცვალეთ „პარამეტრები" გვერდიდან.</p>
        </div>

        <Button data-testid="save-user-profile-button" onClick={save} disabled={saving}
          className="bg-primary hover:bg-orange-600 transition-colors">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "შენახვა"}
        </Button>
      </div>
    </div>
  );
}

