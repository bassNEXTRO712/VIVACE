import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Mail, Phone, KeyRound } from "lucide-react";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function ContactChange({ kind, label, icon: Icon, currentValue, onDone }) {
  const [value, setValue] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState("input"); // input | verify
  const [loading, setLoading] = useState(false);

  const requestCode = async () => {
    if (!value) return;
    setLoading(true);
    try {
      await api.post(`/account/request-${kind}-change`, { new_value: value });
      setStage("verify");
      toast.success("დადასტურების კოდი გაიგზავნა მეილზე");
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  const confirm = async () => {
    setLoading(true);
    try {
      const { data } = await api.post(`/account/confirm-change`, { code });
      toast.success("ცვლილება დადასტურდა");
      setStage("input");
      setValue("");
      setCode("");
      onDone(data.field, data.value);
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Icon className="w-5 h-5 text-primary" />
        <h3 className="font-medium">{label}</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        მიმდინარე: <span className="text-foreground">{currentValue || "—"}</span>
      </p>
      {stage === "input" ? (
        <div className="flex flex-col sm:flex-row gap-3">
          <Input data-testid={`${kind}-new-input`} value={value} onChange={(e) => setValue(e.target.value)}
            placeholder={kind === "email" ? "ახალი მეილი" : "ახალი ტელეფონი"} />
          <Button data-testid={`${kind}-request-button`} onClick={requestCode} disabled={loading}
            className="bg-primary hover:bg-orange-600 transition-colors whitespace-nowrap">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "კოდის გაგზავნა"}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row gap-3">
          <Input data-testid={`${kind}-code-input`} value={code} onChange={(e) => setCode(e.target.value)}
            placeholder="6-ნიშნა კოდი" maxLength={6} />
          <Button data-testid={`${kind}-confirm-button`} onClick={confirm} disabled={loading}
            className="bg-primary hover:bg-orange-600 transition-colors whitespace-nowrap">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "დადასტურება"}
          </Button>
          <Button variant="ghost" onClick={() => setStage("input")}>გაუქმება</Button>
        </div>
      )}
    </div>
  );
}

function PasswordChange() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      await api.post("/account/change-password", { current_password: current, new_password: next });
      toast.success("პაროლი განახლდა");
      setCurrent("");
      setNext("");
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-6 space-y-4">
      <div className="flex items-center gap-2">
        <KeyRound className="w-5 h-5 text-primary" />
        <h3 className="font-medium">პაროლის შეცვლა</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>მიმდინარე პაროლი</Label>
          <Input data-testid="current-password-input" type="password" value={current}
            onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>ახალი პაროლი</Label>
          <Input data-testid="new-password-input" type="password" value={next}
            onChange={(e) => setNext(e.target.value)} />
        </div>
      </div>
      <Button data-testid="change-password-button" onClick={submit} disabled={loading || !current || !next}
        className="bg-primary hover:bg-orange-600 transition-colors">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "პაროლის განახლება"}
      </Button>
    </div>
  );
}

export default function AccountSettings() {
  const { user, setUser } = useAuth();

  const onDone = (field, value) => {
    setUser((u) => ({ ...u, [field]: value }));
  };

  return (
    <div className="max-w-3xl space-y-6">
      <ContactChange kind="email" label="მეილის შეცვლა" icon={Mail}
        currentValue={user?.email} onDone={onDone} />
      <ContactChange kind="phone" label="ტელეფონის შეცვლა" icon={Phone}
        currentValue={user?.phone} onDone={onDone} />
      <PasswordChange />
    </div>
  );
}
