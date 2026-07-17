import { useCallback, useEffect, useState } from 'react';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import LoadingBlock from '../components/LoadingBlock';
import StatusBadge from '../components/StatusBadge';
import { formatCurrency } from '../lib/format';
import { createPromo, listPromos, setPromoActive, type Promo } from '../services/promos';

const isLive = (promo: Promo): boolean => {
  if (!promo.active) {
    return false;
  }
  const now = Date.now();
  if (promo.startsAt && new Date(promo.startsAt).getTime() > now) {
    return false;
  }
  if (promo.endsAt && new Date(promo.endsAt).getTime() < now) {
    return false;
  }
  return true;
};

// A datetime-local value has no timezone; treat it as local and store as ISO.
const toIso = (localValue: string): string | null =>
  localValue ? new Date(localValue).toISOString() : null;

export default function PromosPage() {
  const [promos, setPromos] = useState<Promo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [actionUrl, setActionUrl] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [detailBody, setDetailBody] = useState('');
  const [terms, setTerms] = useState('');
  const [ctaLabel, setCtaLabel] = useState('');
  const [imageUrl, setImageUrl] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await listPromos();
      setPromos(res.promos);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to load promos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onCreate = async () => {
    setBusy(true);
    try {
      await createPromo({
        title,
        body,
        actionUrl: actionUrl.trim() || null,
        startsAt: toIso(startsAt),
        endsAt: toIso(endsAt),
        detailBody: detailBody.trim() || null,
        terms: terms.trim() || null,
        ctaLabel: ctaLabel.trim() || null,
        imageUrl: imageUrl.trim() || null,
      });
      setTitle('');
      setBody('');
      setActionUrl('');
      setStartsAt('');
      setEndsAt('');
      setDetailBody('');
      setTerms('');
      setCtaLabel('');
      setImageUrl('');
      setError(null);
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Create failed.');
    } finally {
      setBusy(false);
    }
  };

  const onToggle = async (promo: Promo) => {
    setBusy(true);
    try {
      await setPromoActive(promo.id, !promo.active);
      setError(null);
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Update failed.');
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = title.trim().length > 0 && body.trim().length > 0 && !busy;

  return (
    <section className="page promos-page">
      <div className="promo-compose card">
        <h3>New promo</h3>
        <p className="muted">
          Broadcasts a live in-app banner to every customer currently on the app, and stays fetchable while active.
        </p>
        {error ? <ErrorBanner message={error} /> : null}
        <div className="field">
          <label htmlFor="promo-title">Title</label>
          <input
            id="promo-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="🍕 20% off lunch"
          />
        </div>
        <div className="field">
          <label htmlFor="promo-body">Body</label>
          <textarea
            id="promo-body"
            rows={3}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Order 12–2pm today and get 20% off."
          />
        </div>
        <div className="field">
          <label htmlFor="promo-url">Deep link (optional)</label>
          <input
            id="promo-url"
            value={actionUrl}
            onChange={(event) => setActionUrl(event.target.value)}
            placeholder="/deals"
          />
        </div>
        <div className="field">
          <label htmlFor="promo-detail">Detail description (optional)</label>
          <textarea
            id="promo-detail"
            rows={4}
            value={detailBody}
            onChange={(event) => setDetailBody(event.target.value)}
            placeholder="Full explanation shown on the promo's landing page."
          />
        </div>
        <div className="field">
          <label htmlFor="promo-terms">Terms / fine print (optional)</label>
          <textarea
            id="promo-terms"
            rows={2}
            value={terms}
            onChange={(event) => setTerms(event.target.value)}
            placeholder="Valid 12–2pm · selected restaurants · min order ₦2000"
          />
        </div>
        <div className="field">
          <label htmlFor="promo-cta">CTA label (optional)</label>
          <input
            id="promo-cta"
            value={ctaLabel}
            onChange={(event) => setCtaLabel(event.target.value)}
            placeholder="Order now"
          />
        </div>
        <div className="field">
          <label htmlFor="promo-starts">Starts (optional)</label>
          <input
            id="promo-starts"
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="promo-ends">Ends (optional)</label>
          <input
            id="promo-ends"
            type="datetime-local"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
          />
        </div>
        <button type="button" className="btn btn-primary" disabled={!canSubmit} onClick={() => void onCreate()}>
          {busy ? 'Sending…' : 'Send promo'}
        </button>
      </div>

      <div className="promo-list card">
        <h3>Promos</h3>
        {loading ? (
          <LoadingBlock label="Loading promos…" />
        ) : promos.length === 0 ? (
          <EmptyState title="No promos yet" body="Create one to broadcast a banner to customers on the app." />
        ) : (
          <ul className="promo-items">
            {promos.map((promo) => (
              <li key={promo.id} className="promo-item">
                <div className="promo-item-main">
                  <div className="promo-item-head">
                    <strong>{promo.title}</strong>
                    <StatusBadge tone={isLive(promo) ? 'success' : 'neutral'} label={isLive(promo) ? 'Live' : 'Off'} />
                  </div>
                  <span className="muted">{promo.body}</span>
                  {promo.actionUrl ? <span className="promo-item-url">{promo.actionUrl}</span> : null}
                  <span className="promo-item-stats">
                    {(() => {
                      const impressions = promo.impressions ?? 0;
                      const clicks = promo.clicks ?? 0;
                      const attributedOrders = promo.attributedOrders ?? 0;
                      const attributedRevenue = promo.attributedRevenue ?? 0;
                      const ctr = impressions > 0 ? Math.round((clicks / impressions) * 100) : 0;
                      return (
                        <>
                          {impressions} impr · {clicks} clicks · {ctr}% CTR ·{' '}
                          {attributedOrders} orders · {formatCurrency(attributedRevenue)}
                        </>
                      );
                    })()}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => void onToggle(promo)}
                >
                  {promo.active ? 'Deactivate' : 'Reactivate'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
