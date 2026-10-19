import { useCallback, useEffect, useMemo, useState } from 'react';
import EmptyState from '../components/EmptyState';
import ErrorBanner from '../components/ErrorBanner';
import LoadingBlock from '../components/LoadingBlock';
import StatusBadge from '../components/StatusBadge';
import { useSnapshot } from '../contexts/SnapshotContext';
import { formatCurrency, formatDateTime } from '../lib/format';
import { resolveViewState } from '../lib/viewState';
import {
  createPromoCode,
  listPromoCodes,
  setPromoCodeActive,
  type PromoCode,
  type PromoCodeFunding,
  type PromoCodeType,
} from '../services/promos';

const toIso = (localValue: string): string | null =>
  localValue ? new Date(localValue).toISOString() : null;

const toCap = (raw: string): number | null => {
  const trimmed = raw.trim();
  return trimmed ? Number(trimmed) : null;
};

const describeDiscount = (code: PromoCode): string => {
  if (code.type === 'free_delivery') {
    return 'Free delivery';
  }
  if (code.type === 'percent') {
    return `${code.value ?? 0}% off`;
  }
  return `${formatCurrency(code.value ?? 0)} off`;
};

const isLive = (code: PromoCode): boolean => {
  if (!code.isActive) {
    return false;
  }
  const now = Date.now();
  if (code.startsAt && new Date(code.startsAt).getTime() > now) {
    return false;
  }
  if (code.endsAt && new Date(code.endsAt).getTime() < now) {
    return false;
  }
  return true;
};

const statusLabel = (code: PromoCode): string => {
  if (!code.isActive) {
    return 'Off';
  }
  const now = Date.now();
  if (code.startsAt && new Date(code.startsAt).getTime() > now) {
    return 'Scheduled';
  }
  if (code.endsAt && new Date(code.endsAt).getTime() < now) {
    return 'Expired';
  }
  return 'Live';
};

export default function PromoCodesPage() {
  const { snapshot } = useSnapshot();
  const [codes, setCodes] = useState<PromoCode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const [code, setCode] = useState('');
  const [type, setType] = useState<PromoCodeType>('percent');
  const [value, setValue] = useState('');
  const [minBasket, setMinBasket] = useState('');
  const [perUserCap, setPerUserCap] = useState('');
  const [globalCap, setGlobalCap] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [restaurantId, setRestaurantId] = useState('');
  const [fundingSource, setFundingSource] = useState<PromoCodeFunding>('platform');
  const [isAutomatic, setIsAutomatic] = useState(false);

  const restaurantNames = useMemo(
    () => new Map(snapshot.restaurants.map((restaurant) => [restaurant.id, restaurant.name])),
    [snapshot.restaurants],
  );

  const load = useCallback(async () => {
    try {
      const res = await listPromoCodes();
      setCodes(res.promoCodes);
      setError(null);
      setLoaded(true);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to load promo codes.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const valueNumber = Number(value);
  const needsValue = type !== 'free_delivery';
  const valueOk = !needsValue || (value.trim() !== '' && Number.isFinite(valueNumber) && valueNumber > 0);
  const canSubmit = code.trim().length > 0 && valueOk && !busy;

  const onCreate = async () => {
    setBusy(true);
    try {
      await createPromoCode({
        code: code.trim(),
        type,
        value: needsValue ? valueNumber : 0,
        minBasket: minBasket.trim() ? Number(minBasket) : 0,
        perUserCap: toCap(perUserCap),
        globalCap: toCap(globalCap),
        startsAt: toIso(startsAt),
        endsAt: toIso(endsAt),
        restaurantId: restaurantId || null,
        fundingSource,
        isAutomatic,
      });
      setCode('');
      setValue('');
      setMinBasket('');
      setPerUserCap('');
      setGlobalCap('');
      setStartsAt('');
      setEndsAt('');
      setRestaurantId('');
      setFundingSource('platform');
      setIsAutomatic(false);
      setError(null);
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Create failed.');
    } finally {
      setBusy(false);
    }
  };

  const onToggle = async (promoCode: PromoCode) => {
    setBusy(true);
    try {
      await setPromoCodeActive(promoCode.id, !promoCode.isActive);
      setError(null);
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Update failed.');
    } finally {
      setBusy(false);
    }
  };

  const listState = resolveViewState({ hasData: loaded, error, isEmpty: codes.length === 0 });

  return (
    <section className="page promos-page">
      <div className="promo-compose card">
        <h3>New discount code</h3>
        <p className="muted">
          Money-moving codes customers enter at checkout. Usage caps are enforced atomically at redemption.
        </p>
        {error ? <ErrorBanner message={error} /> : null}
        <div className="field">
          <label htmlFor="code-name">Code</label>
          <input
            id="code-name"
            value={code}
            maxLength={40}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="WELCOME20"
          />
        </div>
        <div className="field">
          <label htmlFor="code-type">Discount type</label>
          <select id="code-type" value={type} onChange={(event) => setType(event.target.value as PromoCodeType)}>
            <option value="percent">Percent off</option>
            <option value="fixed">Fixed amount off</option>
            <option value="free_delivery">Free delivery</option>
          </select>
        </div>
        {needsValue ? (
          <div className="field">
            <label htmlFor="code-value">{type === 'percent' ? 'Percent (1–100)' : 'Amount (NGN)'}</label>
            <input
              id="code-value"
              type="number"
              min={0}
              max={type === 'percent' ? 100 : undefined}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </div>
        ) : null}
        <div className="field">
          <label htmlFor="code-min">Minimum basket, NGN (optional)</label>
          <input id="code-min" type="number" min={0} value={minBasket} onChange={(event) => setMinBasket(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="code-funding">Funded by</label>
          <select
            id="code-funding"
            value={fundingSource}
            onChange={(event) => setFundingSource(event.target.value as PromoCodeFunding)}
          >
            <option value="platform">Platform</option>
            <option value="restaurant">Restaurant</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="code-restaurant">Restaurant scope (optional)</label>
          <select id="code-restaurant" value={restaurantId} onChange={(event) => setRestaurantId(event.target.value)}>
            <option value="">All restaurants</option>
            {snapshot.restaurants.map((restaurant) => (
              <option key={restaurant.id} value={restaurant.id}>
                {restaurant.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="code-user-cap">Per-customer limit (blank = unlimited)</label>
          <input id="code-user-cap" type="number" min={1} value={perUserCap} onChange={(event) => setPerUserCap(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="code-global-cap">Total redemptions limit (blank = unlimited)</label>
          <input id="code-global-cap" type="number" min={1} value={globalCap} onChange={(event) => setGlobalCap(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="code-starts">Starts (optional)</label>
          <input id="code-starts" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="code-ends">Ends (optional)</label>
          <input id="code-ends" type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
        </div>
        <label className="muted" htmlFor="code-auto" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input id="code-auto" type="checkbox" checked={isAutomatic} onChange={(event) => setIsAutomatic(event.target.checked)} />
          Apply automatically when eligible
        </label>
        <button type="button" className="btn btn-primary" disabled={!canSubmit} onClick={() => void onCreate()}>
          {busy ? 'Saving…' : 'Create code'}
        </button>
      </div>

      <div className="promo-list card">
        <h3>Discount codes</h3>
        {listState === 'loading' ? (
          <LoadingBlock label="Loading promo codes…" />
        ) : listState === 'empty' ? (
          <EmptyState title="No discount codes yet" body="Create one on the left; it is usable at checkout as soon as it is live." />
        ) : listState !== 'ready' ? null : (
          <ul className="promo-items">
            {codes.map((promoCode) => {
              const live = isLive(promoCode);
              const scope = promoCode.restaurantId
                ? restaurantNames.get(promoCode.restaurantId) ?? 'One restaurant'
                : 'All restaurants';
              return (
                <li key={promoCode.id} className="promo-item">
                  <div className="promo-item-main">
                    <div className="promo-item-head">
                      <strong style={{ fontFamily: 'monospace' }}>{promoCode.code}</strong>
                      <StatusBadge tone={live ? 'success' : 'neutral'} label={statusLabel(promoCode)} />
                    </div>
                    <span>{describeDiscount(promoCode)}</span>
                    <span className="muted">
                      {scope} · funded by {promoCode.fundingSource}
                      {promoCode.isAutomatic ? ' · automatic' : ''}
                    </span>
                    <span className="promo-item-stats">
                      Min basket {formatCurrency(promoCode.minBasket ?? 0)} · per customer {promoCode.perUserCap ?? '∞'} · total{' '}
                      {promoCode.globalCap ?? '∞'}
                    </span>
                    {promoCode.startsAt || promoCode.endsAt ? (
                      <span className="muted">
                        {promoCode.startsAt ? formatDateTime(promoCode.startsAt) : 'Any time'} –{' '}
                        {promoCode.endsAt ? formatDateTime(promoCode.endsAt) : 'no end'}
                      </span>
                    ) : null}
                  </div>
                  <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void onToggle(promoCode)}>
                    {promoCode.isActive ? 'Deactivate' : 'Reactivate'}
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
