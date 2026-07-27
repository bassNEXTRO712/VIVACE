import { useCallback, useEffect, useMemo, useState } from "react";
import { Star, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import api, { apiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { formatTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const MAX_LEN = 1000;

function Stars({ value = 0, size = "w-4 h-4", onSelect }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= Math.round(value);
        const cls = `${size} ${filled ? "text-primary fill-primary" : "text-muted-foreground"}`;
        return onSelect ? (
          <button
            key={n}
            type="button"
            data-testid={`review-star-${n}`}
            aria-label={`${n} ვარსკვლავი`}
            onClick={() => onSelect(n)}
            className="p-0.5"
          >
            <Star className={cls} />
          </button>
        ) : (
          <Star key={n} className={cls} />
        );
      })}
    </div>
  );
}

export default function Reviews({ companyId, isOwner = false }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [reviews, setReviews] = useState([]); // ყოველთვის მასივი — არასდროს undefined
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const load = useCallback(
    async (signal) => {
      if (!companyId) return;
      try {
        const { data } = await api.get(`/company/${companyId}/reviews`, { signal });
        setReviews(Array.isArray(data) ? data : []);
      } catch (err) {
        if (signal?.aborted || err?.code === "ERR_CANCELED") return;
        setReviews([]);
      } finally {
        setLoading(false);
      }
    },
    [companyId]
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setReviews([]);
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const { avg, count, mine } = useMemo(() => {
    const list = reviews || [];
    const total = list.reduce((sum, r) => sum + (Number(r?.rating) || 0), 0);
    return {
      count: list.length,
      avg: list.length ? Math.round((total / list.length) * 10) / 10 : 0,
      mine: user ? list.find((r) => r?.user_id === user.id) : undefined,
    };
  }, [reviews, user]);

  const submit = async () => {
    const value = text.trim();
    if (sending || (!value && !rating)) return;
    setSending(true);
    try {
      const { data } = await api.post(`/company/${companyId}/reviews`, {
        rating: Number(rating) || 5,
        text: value,
      });
      if (data?.id) {
        setReviews((prev) => [data, ...(prev || []).filter((r) => r?.id !== data.id)]);
      }
      setText("");
      setRating(5);
    } catch (err) {
      apiError(err);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="space-y-5" data-testid="reviews-section">
      <div className="flex items-center gap-3">
        <h3 className="text-lg font-semibold">შეფასებები</h3>
        <Stars value={avg} />
        <span className="text-sm text-muted-foreground" data-testid="reviews-summary">
          {count > 0 ? `${avg} / 5 · ${count} შეფასება` : "შეფასება ჯერ არ არის"}
        </span>
      </div>

      {!isOwner && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          {!user ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                შეფასების დასატოვებლად გაიარეთ ავტორიზაცია.
              </p>
              <Button
                data-testid="reviews-login-button"
                onClick={() => navigate("/login")}
                className="bg-primary hover:bg-orange-600 transition-colors"
              >
                ავტორიზაცია
              </Button>
            </div>
          ) : (
            <>
              {mine && (
                <p className="text-xs text-muted-foreground">
                  თქვენ უკვე დატოვეთ შეფასება — ახალი დაემატება სიაში.
                </p>
              )}
              <Stars value={rating} size="w-6 h-6" onSelect={setRating} />
              <Textarea
                data-testid="review-text-input"
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
                placeholder="დაწერეთ თქვენი შეფასება..."
                rows={3}
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {text.length}/{MAX_LEN}
                </span>
                <Button
                  data-testid="review-submit-button"
                  onClick={submit}
                  disabled={sending || !text.trim()}
                  className="bg-primary hover:bg-orange-600 transition-colors"
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : "გამოქვეყნება"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : count === 0 ? (
        <p className="text-sm text-muted-foreground py-4">ჯერ არავის დაუტოვებია შეფასება.</p>
      ) : (
        <ul className="space-y-4" data-testid="reviews-list">
          {(reviews || []).map((r, i) => (
            <li key={r?.id || i} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-3">
                {r?.avatar_url ? (
                  <img
                    src={r.avatar_url}
                    alt=""
                    loading="lazy"
                    className="w-8 h-8 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs">
                    {(r?.user_name || "მ").slice(0, 1)}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{r?.user_name || "მომხმარებელი"}</p>
                  <p className="text-[11px] text-muted-foreground">{formatTime(r?.created_at)}</p>
                </div>
                <div className="ml-auto">
                  <Stars value={Number(r?.rating) || 0} />
                </div>
              </div>
              {r?.text && (
                <p className="text-sm mt-3 whitespace-pre-wrap break-words">{r.text}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
