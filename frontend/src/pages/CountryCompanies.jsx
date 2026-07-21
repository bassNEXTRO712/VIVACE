import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { ArrowLeft, MapPin, Building2, ImageIcon, Loader2, BadgeCheck } from "lucide-react";
import api, { fileUrl } from "@/lib/api";
import { imageFor } from "@/lib/destImages";
import Header from "@/components/Header";
import { Badge } from "@/components/ui/badge";

export default function CountryCompanies() {
  const { country } = useParams();
  const [params] = useSearchParams();
  const city = params.get("city");
  const navigate = useNavigate();
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const decoded = decodeURIComponent(country);

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams({ country: decoded });
    if (city) qs.set("city", city);
    api
      .get(`/companies?${qs.toString()}`)
      .then((res) => setCompanies(res.data))
      .finally(() => setLoading(false));
  }, [decoded, city]);

  const heroImg = useMemo(() => imageFor(decoded), [decoded]);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="relative h-52 overflow-hidden">
        <img src={heroImg} alt={decoded} className="w-full h-full object-cover opacity-50" />
        <div className="absolute inset-0 bg-gradient-to-t from-background to-background/30" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 -mt-16 relative z-10 pb-20">
        <button data-testid="back-button" onClick={() => navigate(-1)}
          className="text-muted-foreground hover:text-foreground text-sm flex items-center gap-1 mb-4">
          <ArrowLeft className="w-4 h-4" /> უკან დაბრუნება
        </button>
        <h1 className="text-3xl sm:text-4xl font-bold mb-2">
          {decoded}{city ? ` · ${city}` : ""}
        </h1>
        <p className="text-muted-foreground mb-8">
          {loading ? "იტვირთება..." : `${companies.length} დარეგისტრირებული კომპანია`}
        </p>

        {loading ? (
          <div className="flex justify-center py-24">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
          </div>
        ) : companies.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-12 text-center">
            <Building2 className="w-10 h-10 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              ამ {city ? "ქალაქში" : "ქვეყანაში"} კომპანიები ჯერ არ არის დარეგისტრირებული.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {companies.map((c) => (
              <button key={c.id} data-testid="company-card"
                onClick={() => navigate(`/company/${c.id}`)}
                className="group text-left bg-card border border-border rounded-xl overflow-hidden hover:border-primary transition-colors">
                <div className="relative h-40 overflow-hidden bg-secondary">
                  {c.cover_url ? (
                    <img src={fileUrl(c.cover_url)} alt={c.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  ) : (
                    <img src={imageFor(c.id)} alt={c.name}
                      className="w-full h-full object-cover opacity-70 group-hover:scale-105 transition-transform duration-500" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-card/90 to-transparent" />
                  <div className="absolute bottom-3 left-3 flex items-center gap-3">
                    <div className="w-12 h-12 rounded-lg overflow-hidden border border-border bg-card flex-shrink-0">
                      {c.logo_url ? (
                        <img src={fileUrl(c.logo_url)} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Building2 className="w-5 h-5 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <h3 className="font-semibold text-lg drop-shadow flex items-center gap-1">
                      {c.name}
                      {c.verified && <BadgeCheck className="w-4 h-4 text-primary" />}
                    </h3>
                  </div>
                </div>
                <div className="p-4 space-y-3">
                  {c.description ? (
                    <p className="text-sm text-muted-foreground line-clamp-2">{c.description}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">აღწერა არ არის</p>
                  )}
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <ImageIcon className="w-3 h-3" /> {c.media_count} მედია
                    </span>
                    {c.service_cities?.length > 0 && (
                      <Badge variant="secondary" className="bg-secondary border border-border">
                        <MapPin className="w-3 h-3 mr-1 text-primary" /> {c.service_cities.length} ქალაქი
                      </Badge>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
