import { useState } from "react";
import { toast } from "sonner";
import { Loader2, User } from "lucide-react";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function UserProfile() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [saving, setSaving] = useState(false);

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
          <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-2xl font-semibold uppercase">
            {(user?.name || user?.email || "?").charAt(0)}
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
