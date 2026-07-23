import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Star, Loader2 } from "lucide-react";
import api, { apiError, fileUrl } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

function Stars({ value, size = "w-4 h-4", onSelect }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" disabled={!onSelect}
          data-testid={onSelect ? `star-${n}` : undefined}
          onClick={() => onSelect && onSelect(n)}
          className={onSelect ? "cursor-pointer" : "cursor-default"}>
          <Star className={`${size} ${n <= value ? "fill-primary text-primary" : "text-muted-foreground"}`} />
        </button>
      ))}
    </div>
  );
}

export default function Reviews({ companyId, isOwner, onStats }) {
  const { user } = useAuth();
  const [data, setData] = useState({ reviews: [], rating_avg: 0, review_count: 0 });
  const [rating, setRating] = useState(5);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get(`/company/${companyId}/reviews`);
      setData(data);
      onStats && onStats({ rating_avg: data.rating_avg, review_count: data.review_count });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    load();
  }, [companyId]);

  const submit = async () => {
    setSending(true);
    try {
      const { data } = await api.post(`/company/${companyId}/reviews`, { rating, text });
      setData(data);
      onStats && onStats({ rating_avg: data.rating_avg, review_count: data.review_count });
      setText("");
      toast.success("შეფასება დაემატა");
    } catch (err) {
      toast.error(apiError(err));
    } finally {
      setSending(false);
    }
  };

  if (loading) return null;

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium">შეფასებები ({data.review_count})</h3>
        <div className="flex items-center gap-2">
          <Stars value={Math.round(data.rating_avg)} />
          <span className="font-semibold" data-testid="rating-avg">{data.rating_avg || 0}</span>
        </div>
      </div>

      {user && !isOwner && (
        <div className="border border-border rounded-lg p-4 mb-5 space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">თქვენი შეფასება:</span>
            <Stars value={rating} size="w-6 h-6" onSelect={setRating} />
          </div>
          <Textarea data-testid="review-text-input" value={text} onChange={(e) => setText(e.target.value)}
            rows={2} placeholder="დაწერეთ თქვენი გამოცდილება (არასავალდებულო)" />
          <Button data-testid="review-submit-button" onClick={submit} disabled={sending}
            className="bg-primary hover:bg-orange-600 transition-colors">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : "შეფასების დამატება"}
          </Button>
        </div>
      )}

      {data.reviews.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">ჯერ არავის შეუფასებია</p>
      ) : (
        <div className="space-y-4">
          {data.reviews.map((r) => (
            <div key={r.id} data-testid="review-item" className="flex gap-3">
              <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-sm font-semibold uppercase flex-shrink-0 overflow-hidden">
                {r.avatar_url ? <img src={fileUrl(r.avatar_url)} alt="" className="w-full h-full object-cover" /> : (r.user_name || "?").charAt(0)}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-sm">{r.user_name}</p>
                  <Stars value={r.rating} />
                </div>
                {r.text && <p className="text-sm text-muted-foreground mt-1">{r.text}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
