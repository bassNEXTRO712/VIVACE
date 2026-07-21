import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { Plane, Loader2 } from "lucide-react";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login", { email, password });
      login(data.token, data.user);
      toast.success("კეთილი იყოს თქვენი დაბრუნება!");
      if (data.user.role === "admin") navigate("/admin");
      else if (!data.user.email_verified) navigate("/verify-email");
      else navigate("/");
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-11 h-11 rounded-lg bg-primary flex items-center justify-center">
            <Plane className="w-6 h-6 text-primary-foreground" />
          </div>
          <span className="text-xl font-semibold">VIVACE</span>
        </div>
        <div className="bg-card border border-border rounded-lg p-8 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
          <h1 className="text-2xl font-semibold mb-1">ავტორიზაცია</h1>
          <p className="text-muted-foreground text-sm mb-6">შედით თქვენს ანგარიშში</p>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">მეილი</Label>
              <Input id="email" data-testid="login-email-input" type="email" value={email}
                onChange={(e) => setEmail(e.target.value)} required placeholder="you@company.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">პაროლი</Label>
              <Input id="password" data-testid="login-password-input" type="password" value={password}
                onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" />
            </div>
            <Button data-testid="login-submit-button" type="submit" disabled={loading}
              className="w-full bg-primary hover:bg-orange-600 transition-colors">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "შესვლა"}
            </Button>
          </form>
          <p className="text-sm text-muted-foreground mt-4 text-center">
            <Link to="/forgot-password" data-testid="forgot-password-link" className="text-primary hover:underline">
              დაგავიწყდათ პაროლი?
            </Link>
          </p>
          <p className="text-sm text-muted-foreground mt-3 text-center">
            არ გაქვთ ანგარიში?{" "}
            <Link to="/register" data-testid="go-register-link" className="text-primary hover:underline">
              რეგისტრაცია
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
