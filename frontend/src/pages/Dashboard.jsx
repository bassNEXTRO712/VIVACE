import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, LogOut, User, Images, Shield, ExternalLink, Loader2, MessageSquare, Home as HomeIcon } from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { requestNotifyPermission, notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import ProfileEditor from "@/components/ProfileEditor";
import MediaGallery from "@/components/MediaGallery";
import AccountSettings from "@/components/AccountSettings";
import ChatInbox from "@/components/ChatInbox";
import UserProfile from "@/components/UserProfile";
import NotificationBell from "@/components/NotificationBell";

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isCompany = user?.role === "company";
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(isCompany);
  const [unread, setUnread] = useState(0);
  const prevUnread = useRef(0);

  useEffect(() => {
    if (!isCompany) return;
    api.get("/company/me").then(({ data }) => setCompany(data)).finally(() => setLoading(false));
    requestNotifyPermission();
    const poll = async () => {
      try {
        const { data } = await api.get("/chat/inbox/unread-count");
        setUnread(data.count);
        if (data.count > prevUnread.current) {
          notify("VIVACE — ახალი შეტყობინება", "თქვენ მიიღეთ ახალი შეტყობინება კლიენტისგან.");
        }
        prevUnread.current = data.count;
      } catch (_) {}
    };
    poll();
    const t = setInterval(poll, 8000);
    return () => clearInterval(t);
  }, [isCompany]);

  const doLogout = () => {
    logout();
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 sticky top-0 z-20 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate("/")}>
            <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
              {isCompany ? <Building2 className="w-5 h-5 text-primary-foreground" /> : <User className="w-5 h-5 text-primary-foreground" />}
            </div>
            <span className="font-semibold hidden sm:block">{isCompany ? "კომპანიის პანელი" : "ჩემი ანგარიში"}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button data-testid="nav-home-button" variant="ghost" size="sm" onClick={() => navigate("/")}>
              <HomeIcon className="w-4 h-4 mr-1" /> მთავარი
            </Button>
            <NotificationBell />
            {isCompany && company && (
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
        {!isCompany ? (
          <Tabs defaultValue="profile" className="space-y-6">
            <TabsList className="bg-card border border-border">
              <TabsTrigger data-testid="tab-profile" value="profile">
                <User className="w-4 h-4 mr-2" /> პროფილი
              </TabsTrigger>
              <TabsTrigger data-testid="tab-settings" value="settings">
                <Shield className="w-4 h-4 mr-2" /> პარამეტრები
              </TabsTrigger>
            </TabsList>
            <TabsContent value="profile">
              <UserProfile />
            </TabsContent>
            <TabsContent value="settings">
              <AccountSettings />
            </TabsContent>
          </Tabs>
        ) : loading || !company ? (
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
              <TabsTrigger data-testid="tab-messages" value="messages">
                <MessageSquare className="w-4 h-4 mr-2" /> შეტყობინებები
                {unread > 0 && (
                  <span data-testid="messages-unread-badge"
                    className="ml-2 min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center">
                    {unread}
                  </span>
                )}
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
            <TabsContent value="messages">
              <ChatInbox />
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
