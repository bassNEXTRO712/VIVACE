import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Shield, Users, Building2, Star, MessageSquare, Trash2, LogOut, Loader2, Ban, CheckCircle2, Pencil, Eye, BadgeCheck, Headset, Megaphone, Home as HomeIcon } from "lucide-react";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import AdminSupport from "@/components/AdminSupport";
import AdminAds from "@/components/AdminAds";

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 flex items-center gap-4">
      <div className="w-11 h-11 rounded-lg bg-primary/15 text-primary flex items-center justify-center"><Icon className="w-5 h-5" /></div>
      <div><p className="text-2xl font-bold">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>
    </div>
  );
}

function DeleteBtn({ onConfirm, title, desc, testid }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button data-testid={testid} size="icon" variant="destructive" className="h-8 w-8 bg-destructive hover:bg-red-700"><Trash2 className="w-4 h-4" /></Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="bg-card border-border">
        <AlertDialogHeader><AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{desc}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>გაუქმება</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-destructive hover:bg-red-700">წაშლა</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function AdminPanel() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState({});
  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(null);
  const [editName, setEditName] = useState("");
  const [editPass, setEditPass] = useState("");

  const load = async () => {
    try {
      const [s, u, c] = await Promise.all([api.get("/admin/stats"), api.get("/admin/users"), api.get("/admin/companies")]);
      setStats(s.data); setUsers(u.data); setCompanies(c.data);
    } catch (err) { toast.error(apiError(err)); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); api.post("/admin/seen").catch(() => {}); }, []);

  const delUser = async (id) => { try { await api.delete(`/admin/users/${id}`); toast.success("წაიშალა"); load(); } catch (e) { toast.error(apiError(e)); } };
  const delCompany = async (id) => { try { await api.delete(`/admin/companies/${id}`); toast.success("წაიშალა"); load(); } catch (e) { toast.error(apiError(e)); } };
  const toggleBlock = async (u) => { try { await api.put(`/admin/users/${u.id}`, { blocked: !u.blocked }); toast.success(u.blocked ? "განიბლოკა" : "დაიბლოკა"); load(); } catch (e) { toast.error(apiError(e)); } };
  const toggleVerify = async (c) => { try { await api.post(`/admin/companies/${c.id}/verify`); toast.success(c.verified ? "ვერიფიკაცია მოხსნა" : "დავერიფიცირდა"); load(); } catch (e) { toast.error(apiError(e)); } };
  const openEdit = (u) => { setEdit(u); setEditName(u.name); setEditPass(""); };
  const saveEdit = async () => {
    try {
      // backend UserAdminUpdate: { blocked?, role? } — სახელი /auth/profile-ით იცვლება
      const updates = {};
      if (editPass === "block") updates.blocked = true;
      if (editPass === "unblock") updates.blocked = false;
      if (Object.keys(updates).length) {
        await api.put(`/admin/users/${edit.id}`, updates);
      }
      // სახელი — ცალკე endpoint-ით
      if (editName !== edit.name) {
        await api.put("/auth/profile", { name: editName });
      }
      toast.success("განახლდა"); setEdit(null); load();
    } catch (e) { toast.error(apiError(e)); }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 sticky top-0 z-20 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center"><Shield className="w-5 h-5 text-primary-foreground" /></div>
            <span className="font-semibold">ადმინ პანელი</span>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <Button variant="ghost" size="sm" onClick={() => navigate("/")}><HomeIcon className="w-4 h-4 sm:mr-1" /><span className="hidden sm:inline">საიტი</span></Button>
            <span className="text-sm text-muted-foreground hidden md:block">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={() => { logout(); navigate("/"); }}><LogOut className="w-4 h-4 sm:mr-1" /><span className="hidden sm:inline">გასვლა</span></Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {loading ? <div className="flex justify-center py-24"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div> : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <StatCard icon={Users} label="მომხმარებელი" value={stats.users || 0} />
              <StatCard icon={Building2} label="კომპანია" value={stats.companies || 0} />
              <StatCard icon={Star} label="შეფასება" value={stats.reviews || 0} />
              <StatCard icon={MessageSquare} label="შეტყობინება" value={stats.messages || 0} />
            </div>

            <Tabs defaultValue="users" className="space-y-6">
              <TabsList className="bg-card border border-border flex-wrap h-auto">
                <TabsTrigger data-testid="admin-tab-users" value="users"><Users className="w-4 h-4 mr-1" />მომხმარებლები</TabsTrigger>
                <TabsTrigger data-testid="admin-tab-companies" value="companies"><Building2 className="w-4 h-4 mr-1" />კომპანიები</TabsTrigger>
                <TabsTrigger data-testid="admin-tab-support" value="support"><Headset className="w-4 h-4 mr-1" />მიმართვები</TabsTrigger>
                <TabsTrigger data-testid="admin-tab-ads" value="ads"><Megaphone className="w-4 h-4 mr-1" />რეკლამა</TabsTrigger>
              </TabsList>

              <TabsContent value="users">
                <div className="bg-card border border-border rounded-xl divide-y divide-border">
                  {users.map((u) => (
                    <div key={u.id} data-testid="admin-user-row" className="flex items-center gap-2 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate flex items-center gap-2">
                          {u.name} <span className="text-xs text-muted-foreground">({u.role})</span>
                          {u.blocked && <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded">დაბლოკილი</span>}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                      </div>
                      {u.role !== "admin" && (
                        <>
                          <Button data-testid="admin-edit-user" size="icon" variant="outline" className="h-8 w-8 border-border" onClick={() => openEdit(u)}><Pencil className="w-4 h-4" /></Button>
                          <Button data-testid="admin-block-user" size="icon" variant="outline" className="h-8 w-8 border-border" onClick={() => toggleBlock(u)}>
                            {u.blocked ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Ban className="w-4 h-4 text-red-400" />}
                          </Button>
                          <DeleteBtn testid="admin-delete-user" title="წაშლა?" desc={`${u.email} სამუდამოდ წაიშლება.`} onConfirm={() => delUser(u.id)} />
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="companies">
                <div className="bg-card border border-border rounded-xl divide-y divide-border">
                  {companies.map((c) => (
                    <div key={c.id} data-testid="admin-company-row" className="flex items-center gap-2 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate flex items-center gap-1">
                          {c.name} {c.verified && <BadgeCheck className="w-4 h-4 text-primary" />}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{c.country || "—"} · {c.media_count} მედია</p>
                      </div>
                      <Button data-testid="admin-view-company" size="icon" variant="outline" className="h-8 w-8 border-border" onClick={() => window.open(`/company/${c.id}`, "_blank")}><Eye className="w-4 h-4" /></Button>
                      <Button data-testid="admin-verify-company" size="icon" variant="outline" className={`h-8 w-8 border-border ${c.verified ? "text-primary" : ""}`} onClick={() => toggleVerify(c)}><BadgeCheck className="w-4 h-4" /></Button>
                      <DeleteBtn testid="admin-delete-company" title="წაშლა?" desc={`${c.name} და მფლობელი წაიშლება.`} onConfirm={() => delCompany(c.id)} />
                    </div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="support"><AdminSupport /></TabsContent>
              <TabsContent value="ads"><AdminAds /></TabsContent>
            </Tabs>
          </>
        )}
      </main>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="bg-card border-border">
          <DialogHeader>
            <DialogTitle>მომხმარებლის რედაქტირება</DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm">
              {edit?.email}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>სახელი</Label>
              <Input data-testid="admin-edit-name" value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>სტატუსი</Label>
              <select
                className="w-full border border-border bg-background rounded-md px-3 py-2 text-sm"
                value={editPass}
                onChange={(e) => setEditPass(e.target.value)}
              >
                <option value="">უცვლელი</option>
                <option value="block">დაბლოკვა</option>
                <option value="unblock">განბლოკვა</option>
              </select>
            </div>
            <Button data-testid="admin-edit-save" onClick={saveEdit} className="bg-primary hover:bg-orange-600 w-full">შენახვა</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
