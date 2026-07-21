import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Shield, Users, Building2, Star, MessageSquare, Trash2, LogOut, Loader2 } from "lucide-react";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 flex items-center gap-4">
      <div className="w-11 h-11 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
        <Icon className="w-5 h-5" />
      </div>
      <div>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

export default function AdminPanel() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState({});
  const [users, setUsers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [s, u, c] = await Promise.all([
        api.get("/admin/stats"), api.get("/admin/users"), api.get("/admin/companies"),
      ]);
      setStats(s.data); setUsers(u.data); setCompanies(c.data);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const delUser = async (id) => {
    try { await api.delete(`/admin/users/${id}`); toast.success("წაიშალა"); load(); }
    catch (err) { toast.error(apiError(err)); }
  };
  const delCompany = async (id) => {
    try { await api.delete(`/admin/companies/${id}`); toast.success("წაიშალა"); load(); }
    catch (err) { toast.error(apiError(err)); }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 sticky top-0 z-20 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-semibold">ადმინ პანელი</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground hidden md:block">{user?.email}</span>
            <Button variant="ghost" size="sm" onClick={() => { logout(); navigate("/"); }}>
              <LogOut className="w-4 h-4 mr-1" /> გასვლა
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {loading ? (
          <div className="flex justify-center py-24"><Loader2 className="w-8 h-8 text-primary animate-spin" /></div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <StatCard icon={Users} label="მომხმარებელი" value={stats.users || 0} />
              <StatCard icon={Building2} label="კომპანია" value={stats.companies || 0} />
              <StatCard icon={Star} label="შეფასება" value={stats.reviews || 0} />
              <StatCard icon={MessageSquare} label="შეტყობინება" value={stats.messages || 0} />
            </div>

            <Tabs defaultValue="users" className="space-y-6">
              <TabsList className="bg-card border border-border">
                <TabsTrigger data-testid="admin-tab-users" value="users">მომხმარებლები</TabsTrigger>
                <TabsTrigger data-testid="admin-tab-companies" value="companies">კომპანიები</TabsTrigger>
              </TabsList>

              <TabsContent value="users">
                <div className="bg-card border border-border rounded-xl divide-y divide-border">
                  {users.map((u) => (
                    <div key={u.id} data-testid="admin-user-row" className="flex items-center gap-3 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{u.name} <span className="text-xs text-muted-foreground">({u.role})</span></p>
                        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                      </div>
                      {u.role !== "admin" && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button data-testid="admin-delete-user" size="icon" variant="destructive" className="h-8 w-8 bg-destructive hover:bg-red-700">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent className="bg-card border-border">
                            <AlertDialogHeader>
                              <AlertDialogTitle>წაშლა?</AlertDialogTitle>
                              <AlertDialogDescription>{u.email} სამუდამოდ წაიშლება მთელ მონაცემებთან ერთად.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>გაუქმება</AlertDialogCancel>
                              <AlertDialogAction data-testid="admin-confirm-delete-user" onClick={() => delUser(u.id)} className="bg-destructive hover:bg-red-700">წაშლა</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="companies">
                <div className="bg-card border border-border rounded-xl divide-y divide-border">
                  {companies.map((c) => (
                    <div key={c.id} data-testid="admin-company-row" className="flex items-center gap-3 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{c.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{c.country || "—"} · {c.media_count} მედია</p>
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button data-testid="admin-delete-company" size="icon" variant="destructive" className="h-8 w-8 bg-destructive hover:bg-red-700">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="bg-card border-border">
                          <AlertDialogHeader>
                            <AlertDialogTitle>წაშლა?</AlertDialogTitle>
                            <AlertDialogDescription>{c.name} და მისი მფლობელის ანგარიში წაიშლება.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>გაუქმება</AlertDialogCancel>
                            <AlertDialogAction data-testid="admin-confirm-delete-company" onClick={() => delCompany(c.id)} className="bg-destructive hover:bg-red-700">წაშლა</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </main>
    </div>
  );
}
