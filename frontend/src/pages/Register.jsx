import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { Building2, Loader2, User } from "lucide-react";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Register() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState("user");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post("/auth/register", { name, email, password, role });
      login(data.token, data.user);
      toast.success("ანგარიში შეიქმნა!");
      navigate("/dashboard");
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-11 h-11 rounded-lg bg-primary flex items-center justify-center">
            <Building2 className="w-6 h-6 text-primary-foreground" />
          </div>
          <span className="text-xl font-semibold">VIVACE</span>
        </div>
        <div className="bg-card border border-border rounded-lg p-8 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
          <h1 className="text-2xl font-semibold mb-1">რეგისტრაცია</h1>
          <p className="text-muted-foreground text-sm mb-6">აირჩიეთ ანგარიშის ტიპი</p>

          <div className="grid grid-cols-2 gap-3 mb-6">
            <button type="button" data-testid="role-user-button" onClick={() => setRole("user")}
              className={`rounded-lg border p-4 text-left transition-colors ${
                role === "user" ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
              }`}>
              <User className={`w-5 h-5 mb-2 ${role === "user" ? "text-primary" : "text-muted-foreground"}`} />
              <p className="font-medium text-sm">მომხმარებელი</p>
              <p className="text-xs text-muted-foreground mt-1">ათვალიერე და დაუკავშირდი კომპანიებს</p>
            </button>
            <button type="button" data-testid="role-company-button" onClick={() => setRole("company")}
              className={`rounded-lg border p-4 text-left transition-colors ${
                role === "company" ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
              }`}>
              <Building2 className={`w-5 h-5 mb-2 ${role === "company" ? "text-primary" : "text-muted-foreground"}`} />
              <p className="font-medium text-sm">კომპანია</p>
              <p className="text-xs text-muted-foreground mt-1">შექმენი საჯარო პროფილი და გალერეა</p>
            </button>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">{role === "company" ? "კომპანიის სახელი" : "სახელი"}</Label>
              <Input id="name" data-testid="register-name-input" value={name}
                onChange={(e) => setName(e.target.value)} required
                placeholder={role === "company" ? "შპს კომპანია" : "თქვენი სახელი"} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">მეილი</Label>
              <Input id="email" data-testid="register-email-input" type="email" value={email}
                onChange={(e) => setEmail(e.target.value)} required placeholder="you@company.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">პაროლი</Label>
              <Input id="password" data-testid="register-password-input" type="password" value={password}
                onChange={(e) => setPassword(e.target.value)} required placeholder="მინიმუმ 6 სიმბოლო" />
            </div>
            <Button data-testid="register-submit-button" type="submit" disabled={loading}
              className="w-full bg-primary hover:bg-orange-600 transition-colors">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "რეგისტრაცია"}
            </Button>
          </form>
          <p className="text-sm text-muted-foreground mt-6 text-center">
            უკვე გაქვთ ანგარიში?{" "}
            <Link to="/login" data-testid="go-login-link" className="text-primary hover:underline">
              ავტორიზაცია
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
