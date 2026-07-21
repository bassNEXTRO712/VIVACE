import { useNavigate } from "react-router-dom";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import Header from "@/components/Header";

const SECTIONS = [
  { t: "1. ზოგადი დებულებები", d: "VIVACE არის ტურისტული კომპანიების საკატალოგო პლატფორმა, რომელიც აკავშირებს მომხმარებლებსა და ტურისტულ კომპანიებს. პლატფორმის გამოყენებით თქვენ ეთანხმებით ამ წესებს." },
  { t: "2. ანგარიშის რეგისტრაცია", d: "მომხმარებელი ვალდებულია მიუთითოს სწორი და აქტუალური ინფორმაცია. მეილის დადასტურება სავალდებულოა. ერთი პირი პასუხისმგებელია მისი ანგარიშის უსაფრთხოებაზე." },
  { t: "3. კომპანიების ვალდებულებები", d: "დარეგისტრირებული კომპანია პასუხს აგებს მის მიერ განთავსებული ინფორმაციის სისწორეზე. აკრძალულია ყალბი, შეცდომაში შემყვანი ან უკანონო კონტენტის განთავსება." },
  { t: "4. კონტენტი და მედია", d: "ატვირთული ფოტო/ვიდეო არ უნდა არღვევდეს მესამე პირთა საავტორო უფლებებს. VIVACE იტოვებს უფლებას წაშალოს შეუსაბამო კონტენტი." },
  { t: "5. შეფასებები და კომენტარები", d: "შეფასებები უნდა იყოს რეალურ გამოცდილებაზე დაფუძნებული. აკრძალულია შეურაცხმყოფელი, დისკრიმინაციული ან სპამ კომენტარები." },
  { t: "6. კონფიდენციალურობა", d: "თქვენი პერსონალური მონაცემები ინახება უსაფრთხოდ და გამოიყენება მხოლოდ სერვისის მიწოდების მიზნით. პაროლები ინახება დაშიფრული სახით (bcrypt)." },
  { t: "7. ანგარიშის წაშლა", d: "მომხმარებელს ნებისმიერ დროს შეუძლია ანგარიშის სამუდამო წაშლა მეილზე გამოგზავნილი კოდის დადასტურებით." },
  { t: "8. პასუხისმგებლობის შეზღუდვა", d: "VIVACE არ არის მოგზაურობის უშუალო მიმწოდებელი და არ აგებს პასუხს კომპანიასა და მომხმარებელს შორის გაფორმებულ გარიგებებზე." },
];

export default function Policy() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <button data-testid="policy-back-button" onClick={() => navigate(-1)}
          className="text-muted-foreground hover:text-foreground text-sm flex items-center gap-1 mb-6">
          <ArrowLeft className="w-4 h-4" /> უკან
        </button>
        <div className="flex items-center gap-3 mb-2">
          <ShieldCheck className="w-7 h-7 text-primary" />
          <h1 className="text-3xl font-bold">VIVACE Policy</h1>
        </div>
        <p className="text-muted-foreground mb-8">პლატფორმის გამოყენების წესები და პირობები</p>
        <div className="space-y-4">
          {SECTIONS.map((s, i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-6">
              <h2 className="font-semibold mb-2">{s.t}</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">{s.d}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
