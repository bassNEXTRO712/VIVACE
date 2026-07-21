import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { MailCheck, Loader2 } from "lucide-react";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function VerifyEmail() {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const verify = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/auth/verify-email", { code });
      setUser((u) => ({ ...u, email_verified: true }));
      toast.success("მეილი დადასტურდა!");
      navigate("/dashboard");
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setResending(true);
    try {
      await api.post("/auth/resend-verification");
      toast.success("კოდი ხელახლა გაიგზავნა");
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="bg-card border border-border rounded-lg p-8 shadow-[0_8px_32px_rgba(0,0,0,0.5)] text-center">
          <div className="w-14 h-14 rounded-full bg-primary/15 text-primary flex items-center justify-center mx-auto mb-5">
            <MailCheck className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-semibold mb-2">დაადასტურეთ მეილი</h1>
          <p className="text-muted-foreground text-sm mb-6">
            კოდი გაიგზავნა მისამართზე<br /><span className="text-foreground">{user?.email}</span>
          </p>
          <form onSubmit={verify} className="space-y-4">
            <Input data-testid="verify-code-input" value={code} onChange={(e) => setCode(e.target.value)}
              required maxLength={6} placeholder="6-ნიშნა კოდი" className="text-center text-lg tracking-widest" />
            <Button data-testid="verify-submit-button" type="submit" disabled={loading}
              className="w-full bg-primary hover:bg-orange-600 transition-colors">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "დადასტურება"}
            </Button>
          </form>
          <div className="flex items-center justify-between mt-5 text-sm">
            <button data-testid="resend-code-button" onClick={resend} disabled={resending}
              className="text-primary hover:underline">
              {resending ? "იგზავნება..." : "კოდის ხელახლა გაგზავნა"}
            </button>
            <button onClick={() => { logout(); navigate("/"); }} className="text-muted-foreground hover:text-foreground">
              გასვლა
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
