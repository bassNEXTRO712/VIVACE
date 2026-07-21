import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Building2, MapPin, Phone, Mail, Globe, Loader2, Film } from "lucide-react";
import api, { fileUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Badge } from "@/components/ui/badge";
import Header from "@/components/Header";
import ChatWidget from "@/components/ChatWidget";

export default function PublicProfile() {
  const { id } = useParams();
  const { user } = useAuth();
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    api
      .get(`/company/${id}`)
      .then((res) => setCompany(res.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );

  if (error || !company)
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        პროფილი ვერ მოიძებნა
      </div>
    );

  const media = company.media || [];

  return (
    <div className="min-h-screen bg-background">
      <Header />
      {/* Cover */}
      <div className="relative h-56 md:h-72 bg-secondary">
        {company.cover_url ? (
          <img src={fileUrl(company.cover_url)} alt="cover" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-secondary to-card" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent" />
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 -mt-16 relative z-10">
        <div className="flex items-end gap-5">
          <div className="w-28 h-28 rounded-xl overflow-hidden bg-card border-2 border-border shadow-lg flex-shrink-0">
            {company.logo_url ? (
              <img src={fileUrl(company.logo_url)} alt="logo" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Building2 className="w-10 h-10 text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="pb-2">
            <h1 className="text-3xl font-bold">{company.name}</h1>
            {company.country && (
              <p className="text-muted-foreground flex items-center gap-1 mt-1">
                <Globe className="w-4 h-4" /> {company.country}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-8">
          <div className="space-y-6">
            <div className="bg-card border border-border rounded-lg p-6 space-y-3">
              <h3 className="font-medium mb-2">საკონტაქტო</h3>
              {company.email && (
                <p className="text-sm flex items-center gap-2 text-muted-foreground">
                  <Mail className="w-4 h-4 text-primary" /> {company.email}
                </p>
              )}
              {company.phone && (
                <p className="text-sm flex items-center gap-2 text-muted-foreground">
                  <Phone className="w-4 h-4 text-primary" /> {company.phone}
                </p>
              )}
              {company.address && (
                <p className="text-sm flex items-center gap-2 text-muted-foreground">
                  <MapPin className="w-4 h-4 text-primary" /> {company.address}
                </p>
              )}
            </div>
            {company.service_cities?.length > 0 && (
              <div className="bg-card border border-border rounded-lg p-6">
                <h3 className="font-medium mb-3">სამომსახურეო ქალაქები</h3>
                <div className="flex flex-wrap gap-2">
                  {company.service_cities.map((c) => (
                    <Badge key={c} variant="secondary" className="bg-secondary border border-border">
                      <MapPin className="w-3 h-3 mr-1 text-primary" /> {c}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="lg:col-span-2 space-y-6">
            {company.description && (
              <div className="bg-card border border-border rounded-lg p-6">
                <h3 className="font-medium mb-2">კომპანიის შესახებ</h3>
                <p className="text-muted-foreground leading-relaxed whitespace-pre-line">{company.description}</p>
              </div>
            )}
            <div className="bg-card border border-border rounded-lg p-6">
              <h3 className="font-medium mb-4">გალერეა ({media.length})</h3>
              {media.length === 0 ? (
                <p className="text-muted-foreground text-sm py-8 text-center">მედია არ არის</p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {media.map((m) => (
                    <div key={m.id} className="relative rounded-md overflow-hidden border border-border aspect-square bg-secondary">
                      {m.type === "video" ? (
                        <video src={fileUrl(m.url)} className="w-full h-full object-cover" controls />
                      ) : (
                        <img src={fileUrl(m.url)} alt="" className="w-full h-full object-cover" />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="h-16" />
      </div>
      <ChatWidget companyId={company.id} companyName={company.name}
        isOwner={user?.company_id === company.id} />
    </div>
  );
}
