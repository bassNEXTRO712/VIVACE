import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { Building2, Loader2, KeyRound } from "lucide-react";
import api, { apiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [stage, setStage] = useState("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const request = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email });
      toast.success("კოდი გაიგზავნა მეილზე (თუ ანგარიში არსებობს)");
      setStage("reset");
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  const reset = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/auth/reset-password", { email, code, new_password: password });
      toast.success("პაროლი აღდგენილია, გაიარეთ ავტორიზაცია");
      navigate("/login");
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
            <KeyRound className="w-6 h-6 text-primary-foreground" />
          </div>
          <span className="text-xl font-semibold">პაროლის აღდგენა</span>
        </div>
        <div className="bg-card border border-border rounded-lg p-8 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
          {stage === "request" ? (
            <form onSubmit={request} className="space-y-4">
              <h1 className="text-2xl font-semibold mb-1">დაგავიწყდათ პაროლი?</h1>
              <p className="text-muted-foreground text-sm mb-4">შეიყვანეთ მეილი — გამოგიგზავნით კოდს</p>
              <div className="space-y-2">
                <Label htmlFor="fp-email">მეილი</Label>
                <Input id="fp-email" data-testid="forgot-email-input" type="email" value={email}
                  onChange={(e) => setEmail(e.target.value)} required placeholder="you@company.com" />
              </div>
              <Button data-testid="forgot-request-button" type="submit" disabled={loading}
                className="w-full bg-primary hover:bg-orange-600 transition-colors">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "კოდის გაგზავნა"}
              </Button>
            </form>
          ) : (
            <form onSubmit={reset} className="space-y-4">
              <h1 className="text-2xl font-semibold mb-1">ახალი პაროლი</h1>
              <p className="text-muted-foreground text-sm mb-4">შეიყვანეთ მიღებული კოდი და ახალი პაროლი</p>
              <div className="space-y-2">
                <Label htmlFor="fp-code">კოდი</Label>
                <Input id="fp-code" data-testid="forgot-code-input" value={code}
                  onChange={(e) => setCode(e.target.value)} required maxLength={6} placeholder="6-ნიშნა კოდი" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="fp-pass">ახალი პაროლი</Label>
                <Input id="fp-pass" data-testid="forgot-password-input" type="password" value={password}
                  onChange={(e) => setPassword(e.target.value)} required placeholder="მინიმუმ 6 სიმბოლო" />
              </div>
              <Button data-testid="forgot-reset-button" type="submit" disabled={loading}
                className="w-full bg-primary hover:bg-orange-600 transition-colors">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "პაროლის აღდგენა"}
              </Button>
            </form>
          )}
          <p className="text-sm text-muted-foreground mt-6 text-center">
            <Link to="/login" data-testid="back-to-login-link" className="text-primary hover:underline">
              ← ავტორიზაციაზე დაბრუნება
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
