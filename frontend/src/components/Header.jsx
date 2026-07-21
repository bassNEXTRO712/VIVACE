import { Link, useNavigate } from "react-router-dom";
import { Plane, LogOut, LayoutDashboard, Shield } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { fileUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import NotificationBell from "@/components/NotificationBell";

export default function Header({ transparent = false }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <header
      className={`sticky top-0 z-30 ${
        transparent
          ? "bg-transparent"
          : "bg-background/85 backdrop-blur border-b border-border"
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link to="/" data-testid="brand-logo" className="flex items-center gap-2 group">
          <span className="text-2xl font-bold tracking-tight text-foreground">VIVACE</span>
          <Plane className="w-5 h-5 text-primary group-hover:translate-x-1 transition-transform" />
        </Link>
        <nav className="flex items-center gap-2">
          {user ? (
            <>
              {user.role === "admin" && (
                <Button data-testid="nav-admin" variant="ghost" size="sm" onClick={() => navigate("/admin")}>
                  <Shield className="w-4 h-4 mr-1" /> <span className="hidden sm:inline">ადმინ</span>
                </Button>
              )}
              <NotificationBell />
              <Button data-testid="nav-dashboard" variant="ghost" size="icon" className="sm:hidden"
                onClick={() => navigate("/dashboard")} aria-label="dashboard">
                <LayoutDashboard className="w-4 h-4" />
              </Button>
              <Button data-testid="nav-dashboard-lg" variant="ghost" size="sm" className="hidden sm:inline-flex"
                onClick={() => navigate("/dashboard")}>
                <LayoutDashboard className="w-4 h-4 mr-1" /> ჩემი პროფილი
              </Button>
              <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-semibold uppercase overflow-hidden flex-shrink-0">
                {user.avatar_url ? (
                  <img src={fileUrl(user.avatar_url)} alt="" className="w-full h-full object-cover" />
                ) : (
                  (user.name || user.email || "?").charAt(0)
                )}
              </div>
              <Button data-testid="nav-logout" variant="ghost" size="icon"
                onClick={() => { logout(); navigate("/"); }} aria-label="logout">
                <LogOut className="w-4 h-4" />
              </Button>
            </>
          ) : (
            <>
              <Button data-testid="nav-login" variant="ghost" size="sm"
                onClick={() => navigate("/login")}>
                ავტორიზაცია
              </Button>
              <Button data-testid="nav-register" size="sm"
                onClick={() => navigate("/register")}
                className="bg-primary hover:bg-orange-600 transition-colors">
                რეგისტრაცია
              </Button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
