import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Country, City } from "country-state-city";
import { Search, MapPin, Building2, ArrowRight, Globe2, Users, Sparkles } from "lucide-react";
import api from "@/lib/api";
import { imageFor, HERO_IMAGE } from "@/lib/destImages";
import Header from "@/components/Header";

export default function Home() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [counts, setCounts] = useState({});
  const [focused, setFocused] = useState(false);
  const boxRef = useRef();

  const countries = useMemo(() => Country.getAllCountries(), []);
  const allCities = useMemo(() => City.getAllCities(), []);
  const isoToName = useMemo(
    () => Object.fromEntries(countries.map((c) => [c.isoCode, c.name])),
    [countries]
  );

  useEffect(() => {
    api.get("/companies-countries").then((res) => {
      const map = {};
      res.data.forEach((r) => (map[r.country] = r.count));
      setCounts(map);
    });
  }, []);

  useEffect(() => {
    const onClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setFocused(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const sortedCountries = useMemo(() => {
    return [...countries].sort((a, b) => {
      const ca = counts[a.name] || 0;
      const cb = counts[b.name] || 0;
      if (ca !== cb) return cb - ca;
      return a.name.localeCompare(b.name);
    });
  }, [countries, counts]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return { countries: [], cities: [] };
    const mc = countries.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 6);
    let mci = [];
    if (q.length >= 3) {
      mci = allCities
        .filter((c) => c.name.toLowerCase().startsWith(q))
        .slice(0, 6)
        .map((c) => ({ ...c, country: isoToName[c.countryCode] }));
    }
    return { countries: mc, cities: mci };
  }, [query, countries, allCities, isoToName]);

  const totalCompanies = useMemo(
    () => Object.values(counts).reduce((a, b) => a + b, 0),
    [counts]
  );
  const activeCountries = Object.keys(counts).length;

  const goCountry = (name) => navigate(`/country/${encodeURIComponent(name)}`);
  const goCity = (country, city) =>
    navigate(`/country/${encodeURIComponent(country)}?city=${encodeURIComponent(city)}`);

  return (
    <div className="min-h-screen bg-background">
      <div className="absolute inset-x-0 top-0 h-[560px] overflow-hidden">
        <img src={HERO_IMAGE} alt="" className="w-full h-full object-cover opacity-40" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/80 to-background" />
      </div>

      <div className="relative z-20">
        <Header transparent />

        {/* Hero */}
        <section className="max-w-5xl mx-auto px-4 sm:px-6 pt-16 pb-10 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/40 bg-primary/10 text-primary text-sm mb-6">
            <Sparkles className="w-4 h-4" /> ტურისტული კომპანიების პლატფორმა
          </div>
          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight mb-4">
            იმოგზაურე მსოფლიოს <span className="text-primary">ნებისმიერ</span> კუთხეში
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto mb-8">
            აღმოაჩინე სანდო ტურისტული კომპანიები ქვეყნებისა და ქალაქების მიხედვით. დაუკავშირდი პირდაპირ ჩატით.
          </p>

          {/* Search */}
          <div ref={boxRef} className="relative max-w-2xl mx-auto">
            <div className="flex items-center bg-card border border-border rounded-full pl-5 pr-2 py-2 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
              <Search className="w-5 h-5 text-muted-foreground mr-3 flex-shrink-0" />
              <input
                data-testid="home-search-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => setFocused(true)}
                placeholder="მოძებნე ქვეყანა ან ქალაქი..."
                className="flex-1 bg-transparent outline-none text-foreground placeholder:text-muted-foreground text-base"
              />
            </div>

            {focused && (suggestions.countries.length > 0 || suggestions.cities.length > 0) && (
              <div className="absolute left-0 right-0 mt-2 bg-popover border border-border rounded-xl shadow-2xl overflow-hidden z-40 text-left">
                {suggestions.countries.map((c) => (
                  <button key={c.isoCode} data-testid="search-country-result"
                    onClick={() => goCountry(c.name)}
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-secondary transition-colors">
                    <span className="text-xl">{c.flag}</span>
                    <span className="flex-1">{c.name}</span>
                    <Globe2 className="w-4 h-4 text-muted-foreground" />
                  </button>
                ))}
                {suggestions.cities.map((c, i) => (
                  <button key={`${c.name}-${i}`} data-testid="search-city-result"
                    onClick={() => goCity(c.country, c.name)}
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-secondary transition-colors border-t border-border/50">
                    <MapPin className="w-4 h-4 text-primary" />
                    <span className="flex-1">{c.name}</span>
                    <span className="text-xs text-muted-foreground">{c.country}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="flex items-center justify-center gap-8 mt-10 text-sm">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-primary" />
              <span className="font-semibold">{totalCompanies}</span>
              <span className="text-muted-foreground">კომპანია</span>
            </div>
            <div className="flex items-center gap-2">
              <Globe2 className="w-4 h-4 text-primary" />
              <span className="font-semibold">{activeCountries}</span>
              <span className="text-muted-foreground">ქვეყანა</span>
            </div>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              <span className="font-semibold">{countries.length}</span>
              <span className="text-muted-foreground">მიმართულება</span>
            </div>
          </div>
        </section>

        {/* Country grid */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-20">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl sm:text-3xl font-semibold">მიმართულებები</h2>
            <span className="text-sm text-muted-foreground">{countries.length} ქვეყანა</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {sortedCountries.slice(0, 60).map((c) => {
              const count = counts[c.name] || 0;
              return (
                <button
                  key={c.isoCode}
                  data-testid="country-card"
                  onClick={() => goCountry(c.name)}
                  className="group text-left bg-card border border-border rounded-xl overflow-hidden hover:border-primary transition-colors"
                >
                  <div className="relative h-40 overflow-hidden">
                    <img src={imageFor(c.name)} alt={c.name} loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    <div className="absolute inset-0 bg-gradient-to-t from-card via-card/30 to-transparent" />
                    {count > 0 && (
                      <span className="absolute top-3 right-3 bg-primary text-primary-foreground text-xs font-semibold px-2 py-1 rounded-full">
                        {count} კომპანია
                      </span>
                    )}
                    <span className="absolute top-3 left-3 text-2xl">{c.flag}</span>
                  </div>
                  <div className="p-4">
                    <h3 className="font-semibold uppercase tracking-wide text-sm truncate">{c.name}</h3>
                    <p className="text-primary text-sm mt-2 flex items-center gap-1 group-hover:gap-2 transition-all">
                      აღმოაჩინე <ArrowRight className="w-3 h-3" />
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
