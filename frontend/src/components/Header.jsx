import { Link, useNavigate } from "react-router-dom";
import { Plane, LogOut, LayoutDashboard } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";

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
              <Button data-testid="nav-dashboard" variant="ghost" size="sm"
                onClick={() => navigate("/dashboard")}>
                <LayoutDashboard className="w-4 h-4 mr-1" /> ჩემი პროფილი
              </Button>
              <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-semibold uppercase">
                {(user.name || user.email || "?").charAt(0)}
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
