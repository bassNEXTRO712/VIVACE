import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, LogOut, User, Images, Shield, ExternalLink, Loader2 } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import ProfileEditor from "@/components/ProfileEditor";
import MediaGallery from "@/components/MediaGallery";
import AccountSettings from "@/components/AccountSettings";

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadCompany = async () => {
    try {
      const { data } = await api.get("/company/me");
      setCompany(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCompany();
  }, []);

  const doLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 sticky top-0 z-20 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
              <Building2 className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="font-semibold hidden sm:block">კომპანიის პროფილი</span>
          </div>
          <div className="flex items-center gap-2">
            {company && (
              <Button data-testid="view-public-button" variant="outline" size="sm"
                onClick={() => window.open(`/company/${company.id}`, "_blank")}
                className="border-border">
                <ExternalLink className="w-4 h-4 mr-1" /> საჯარო პროფილი
              </Button>
            )}
            <span className="text-sm text-muted-foreground hidden md:block">{user?.email}</span>
            <Button data-testid="logout-button" variant="ghost" size="sm" onClick={doLogout}>
              <LogOut className="w-4 h-4 mr-1" /> გასვლა
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {loading || !company ? (
          <div className="flex items-center justify-center py-32">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : (
          <Tabs defaultValue="profile" className="space-y-6">
            <TabsList className="bg-card border border-border">
              <TabsTrigger data-testid="tab-profile" value="profile">
                <User className="w-4 h-4 mr-2" /> პროფილი
              </TabsTrigger>
              <TabsTrigger data-testid="tab-gallery" value="gallery">
                <Images className="w-4 h-4 mr-2" /> გალერეა
              </TabsTrigger>
              <TabsTrigger data-testid="tab-settings" value="settings">
                <Shield className="w-4 h-4 mr-2" /> პარამეტრები
              </TabsTrigger>
            </TabsList>
            <TabsContent value="profile">
              <ProfileEditor company={company} onUpdate={setCompany} />
            </TabsContent>
            <TabsContent value="gallery">
              <MediaGallery company={company} onUpdate={setCompany} />
            </TabsContent>
            <TabsContent value="settings">
              <AccountSettings />
            </TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  );
}
