import { useMemo, useRef, useState } from "react";
import { Country, City } from "country-state-city";
import { toast } from "sonner";
import { Loader2, Upload, X, Plus, MapPin } from "lucide-react";
import api, { apiError, fileUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export default function ProfileEditor({ company, onUpdate }) {
  const [form, setForm] = useState({
    name: company.name || "",
    phone: company.phone || "",
    address: company.address || "",
    country: company.country || "",
    description: company.description || "",
  });
  const [countryIso, setCountryIso] = useState(
    Country.getAllCountries().find((c) => c.name === company.country)?.isoCode || ""
  );
  const [cities, setCities] = useState(company.service_cities || []);
  const [citySearch, setCitySearch] = useState("");
  const [saving, setSaving] = useState(false);
  const logoRef = useRef();
  const coverRef = useRef();
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);

  const countries = useMemo(() => Country.getAllCountries(), []);
  const availableCities = useMemo(() => {
    if (!countryIso) return [];
    const list = City.getCitiesOfCountry(countryIso) || [];
    const q = citySearch.toLowerCase();
    return list
      .filter((c) => c.name.toLowerCase().includes(q))
      .filter((c) => !cities.includes(c.name))
      .slice(0, 30);
  }, [countryIso, citySearch, cities]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const onCountry = (iso) => {
    const c = countries.find((x) => x.isoCode === iso);
    setCountryIso(iso);
    set("country", c?.name || "");
    setCities([]);
  };

  const addCity = (name) => {
    setCities((prev) => [...prev, name]);
    setCitySearch("");
  };
  const removeCity = (name) => setCities((prev) => prev.filter((c) => c !== name));

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put(`/company/${company.id}`, { ...form, service_cities: cities });
      onUpdate(data);
      toast.success("პროფილი შენახულია");
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSaving(false);
    }
  };

  const uploadImage = async (file, kind) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    const setUploading = kind === "logo" ? setUploadingLogo : setUploadingCover;
    setUploading(true);
    try {
      const { data } = await api.post(`/company/${company.id}/${kind}`, fd);
      onUpdate({ ...company, [`${kind}_url`]: data.url });
      toast.success(kind === "logo" ? "ლოგო განახლდა" : "ქავერი განახლდა");
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left: images */}
      <div className="space-y-6">
        <div className="bg-card border border-border rounded-lg p-6">
          <Label className="mb-3 block">ქავერი</Label>
          <div className="relative h-32 rounded-md overflow-hidden bg-secondary border border-border mb-3">
            {company.cover_url ? (
              <img src={fileUrl(company.cover_url)} alt="cover" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
                ქავერი არ არის
              </div>
            )}
          </div>
          <input ref={coverRef} type="file" accept="image/*" hidden
            onChange={(e) => uploadImage(e.target.files[0], "cover")} />
          <Button data-testid="upload-cover-button" variant="outline" size="sm" className="w-full border-border"
            onClick={() => coverRef.current.click()} disabled={uploadingCover}>
            {uploadingCover ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Upload className="w-4 h-4 mr-2" /> ქავერის ატვირთვა</>}
          </Button>
        </div>

        <div className="bg-card border border-border rounded-lg p-6">
          <Label className="mb-3 block">ლოგო</Label>
          <div className="w-24 h-24 rounded-lg overflow-hidden bg-secondary border border-border mb-3">
            {company.logo_url ? (
              <img src={fileUrl(company.logo_url)} alt="logo" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
                ლოგო
              </div>
            )}
          </div>
          <input ref={logoRef} type="file" accept="image/*" hidden
            onChange={(e) => uploadImage(e.target.files[0], "logo")} />
          <Button data-testid="upload-logo-button" variant="outline" size="sm" className="w-full border-border"
            onClick={() => logoRef.current.click()} disabled={uploadingLogo}>
            {uploadingLogo ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Upload className="w-4 h-4 mr-2" /> ლოგოს ატვირთვა</>}
          </Button>
        </div>
      </div>

      {/* Right: form */}
      <div className="lg:col-span-2 bg-card border border-border rounded-lg p-6 md:p-8 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="cname">კომპანიის სახელი</Label>
            <Input id="cname" data-testid="profile-name-input" value={form.name}
              onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cphone">ტელეფონი</Label>
            <Input id="cphone" data-testid="profile-phone-input" value={form.phone}
              onChange={(e) => set("phone", e.target.value)} placeholder="+995 ..." />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="caddr">მისამართი</Label>
          <Input id="caddr" data-testid="profile-address-input" value={form.address}
            onChange={(e) => set("address", e.target.value)} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label>ქვეყანა</Label>
            <Select value={countryIso} onValueChange={onCountry}>
              <SelectTrigger data-testid="profile-country-select">
                <SelectValue placeholder="აირჩიეთ ქვეყანა" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {countries.map((c) => (
                  <SelectItem key={c.isoCode} value={c.isoCode}>
                    {c.flag} {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>სამომსახურეო ქალაქები</Label>
            <Input data-testid="profile-city-search" value={citySearch}
              onChange={(e) => setCitySearch(e.target.value)}
              placeholder={countryIso ? "მოძებნეთ ქალაქი..." : "ჯერ აირჩიეთ ქვეყანა"}
              disabled={!countryIso} />
            {citySearch && availableCities.length > 0 && (
              <div className="bg-popover border border-border rounded-md max-h-48 overflow-y-auto shadow-lg">
                {availableCities.map((c) => (
                  <button key={`${c.name}-${c.latitude}`} type="button" data-testid="city-option"
                    onClick={() => addCity(c.name)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-secondary flex items-center gap-2">
                    <Plus className="w-3 h-3 text-primary" /> {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {cities.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {cities.map((c) => (
              <Badge key={c} data-testid="city-badge" variant="secondary"
                className="bg-secondary border border-border pl-2 pr-1 py-1 gap-1">
                <MapPin className="w-3 h-3 text-primary" /> {c}
                <button type="button" onClick={() => removeCity(c)} aria-label="remove"
                  className="ml-1 hover:text-destructive">
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="cdesc">აღწერა</Label>
          <Textarea id="cdesc" data-testid="profile-description-input" value={form.description}
            onChange={(e) => set("description", e.target.value)} rows={4}
            placeholder="მოკლედ თქვენი კომპანიის შესახებ..." />
        </div>

        <Button data-testid="save-profile-button" onClick={save} disabled={saving}
          className="bg-primary hover:bg-orange-600 transition-colors">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "შენახვა"}
        </Button>
      </div>
    </div>
  );
}
