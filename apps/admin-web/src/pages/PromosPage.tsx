import { useCallback, useEffect, useState } from 'react';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import LoadingBlock from '../components/LoadingBlock';
import StatusBadge from '../components/StatusBadge';
import { formatCurrency, formatDateTime } from '../lib/format';
import { resolveViewState } from '../lib/viewState';
import { createPromo, listPromos, setPromoActive, type Promo } from '../services/promos';
import { uploadPromoAsset } from '../services/promoAssetUpload';

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

/**
 * The scheduling window the composer captures. `isLive` reads both ends of it
 * to decide the Live/Off badge, but the row printed neither, so a single "Off"
 * covered three unrelated situations -- scheduled for later, already expired,
 * and switched off by hand -- and the toggle offered "Deactivate" on a promo
 * that had not started. The dates are already on the payload; the only thing
 * missing was showing them.
 */
const scheduleLabel = (promo: Promo): string | null => {
  if (!promo.startsAt && !promo.endsAt) {
    return null;
  }
  if (!promo.endsAt) {
    return `From ${formatDateTime(promo.startsAt)}`;
  }
  if (!promo.startsAt) {
    return `Until ${formatDateTime(promo.endsAt)}`;
  }
  return `${formatDateTime(promo.startsAt)} – ${formatDateTime(promo.endsAt)}`;
};

/*
 * The `promo_composer_v2` flag was removed here rather than made real.
 *
 * It gated one sentence -- "Experimental composer remains dark until the flag
 * is enabled" -- shown when the flag was OFF, directly above a composer that
 * created and sent promos regardless. So the page stated the opposite of what
 * it did, and the default-closed flag made that the state every operator saw.
 *
 * Wiring the flag to actually disable the composer was the other option and is
 * the wrong one: this composer is the shipped, in-production promo tool, and a
 * flag that defaults closed would have switched a live capability off. A flag
 * that gates nothing is removed; it is not promoted to gating something that
 * has to stay on.
 */
export default function PromosPage() {
  const [promos, setPromos] = useState<Promo[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Only a SUCCESSFUL read may license an empty state, so `loaded` and `error`
  // are the whole story: "still waiting" is simply neither of them, which is
  // what resolveViewState derives below. A separate `loading` flag settled to
  // false on the catch path as well and only ever created a second, wrong
  // answer to the same question.
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

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
      setLoaded(true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to load promos.');
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

  const onPickImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setUploading(true);
    try {
      const url = await uploadPromoAsset(file);
      setImageUrl(url);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Upload failed.');
    } finally {
      setUploading(false);
      event.target.value = '';
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

  const canSubmit = title.trim().length > 0 && body.trim().length > 0 && !busy && !uploading;

  // `loaded`, not `!loading`: the catch path settles `loading` too, so the
  // previous chain fell through to an empty <ul> under the "Promos" heading
  // after a failed read -- a card that looks exactly like "you have no
  // promos" while actually meaning "we never got an answer".
  const listState = resolveViewState({ hasData: loaded, error, isEmpty: promos.length === 0 });

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
          <label htmlFor="promo-image">Hero image (optional)</label>
          <input id="promo-image" type="file" accept="image/*" onChange={(event) => void onPickImage(event)} />
          {uploading ? <span className="muted">Uploading…</span> : null}
          {imageUrl ? (
            <img src={imageUrl} alt="Promo hero preview" style={{ marginTop: 8, maxWidth: 240, borderRadius: 8 }} />
          ) : null}
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
        {listState === 'loading' ? (
          <LoadingBlock label="Loading promos…" />
        ) : listState === 'empty' ? (
          <EmptyState title="No promos yet" body="Create one to broadcast a banner to customers on the app." />
        ) : listState !== 'ready' ? null : (
          <ul className="promo-items">
            {promos.map((promo) => {
              const promoSchedule = scheduleLabel(promo);
              const live = isLive(promo);
              const impressions = promo.impressions ?? 0;
              const clicks = promo.clicks ?? 0;
              const attributedOrders = promo.attributedOrders ?? 0;
              const attributedRevenue = promo.attributedRevenue ?? 0;
              // A ratio with an empty denominator has no value, and "0% CTR"
              // is not that -- it is the reading for a promo that was seen and
              // ignored, which is the opposite conclusion from one nobody has
              // been shown yet.
              const ctr = impressions > 0 ? `${Math.round((clicks / impressions) * 100)}%` : '—';

              return (
                <li key={promo.id} className="promo-item">
                  <div className="promo-item-main">
                    <div className="promo-item-head">
                      <strong>{promo.title}</strong>
                      <StatusBadge tone={live ? 'success' : 'neutral'} label={live ? 'Live' : 'Off'} />
                    </div>
                    <span className="muted">{promo.body}</span>
                    {promo.actionUrl ? <span className="promo-item-url">{promo.actionUrl}</span> : null}
                    {promoSchedule ? <span className="muted">{promoSchedule}</span> : null}
                    <span className="promo-item-stats">
                      {impressions} impr · {clicks} clicks · {ctr} CTR · {attributedOrders} orders ·{' '}
                      {formatCurrency(attributedRevenue)}
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
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
