'use client';
import { useState } from 'react';
import { DEPOP_LOCATIONS, label } from '@/lib/depop/data';
import { api, money, type Me, type Pack, type Theme, type Usage } from '@/lib/client/api';
import { applyTheme } from '@/lib/client/theme';
import { refillDay } from '@/lib/client/items';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { APP_LINKS } from '@/lib/app-config';
import { PickerSheet, ShippingSheet, plainOptions } from './Sheets';
import { External, Next } from './icons';

const CURRENCIES = ['USD', 'GBP', 'EUR', 'AUD', 'CAD'];
const THEMES: [Theme, string][] = [['light', 'Light'], ['dark', 'Dark'], ['system', 'Auto']];

export function useAskForMore(onUsage: (u: Usage) => void, toast: (m: string, e?: boolean) => void) {
  const [busy, setBusy] = useState(false);
  const ask = async () => {
    setBusy(true);
    try {
      const r = await api<{ usage: Usage }>('/api/interest', { method: 'POST' });
      onUsage(r.usage);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return { ask, busy };
}

export function AskButton({ usage, onUsage, toast }: { usage: Usage; onUsage: (u: Usage) => void; toast: (m: string, e?: boolean) => void }) {
  const { ask, busy } = useAskForMore(onUsage, toast);
  return (
    <button type="button" className="chip" onClick={ask} disabled={busy || usage.askedForMore}>
      {busy ? <span className="spin" /> : usage.askedForMore ? 'Asked, thanks' : 'Ask for more'}
    </button>
  );
}

export function SettingsContent({ me, packs = [], onSaved, toast }: { me: Me; packs?: Pack[]; onSaved: (m: Me) => void; toast: (m: string, e?: boolean) => void }) {
  const [pick, setPick] = useState<null | 'location' | 'currency'>(null);
  const [shipOpen, setShipOpen] = useState(false);
  const [out, setOut] = useState(false);
  const u = me.usage;
  const s = me.settings;

  const save = async (patch: Record<string, unknown>) => {
    try {
      const next = await api<Me>('/api/settings', { method: 'PATCH', body: patch });
      onSaved({ ...me, ...next, usage: next.usage || me.usage });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const setTheme = (t: Theme) => {
    if (t === s.theme) return;
    applyTheme(t);
    onSaved({ ...me, settings: { ...s, theme: t } });
    save({ theme: t });
  };
  const [buying, setBuying] = useState<string | null>(null);
  const buy = async (pack: string) => {
    setBuying(pack);
    try {
      const { url } = await api<{ url: string }>('/api/checkout', { method: 'POST', body: { pack } });
      window.location.href = url;
    } catch (e) {
      toast((e as Error).message, true);
      setBuying(null);
    }
  };
  const signOut = async () => {
    setOut(true);
    try {
      await supabaseBrowser().auth.signOut();
    } finally {
      window.location.href = '/';
    }
  };

  const initial = (me.name || me.email || '?').trim().charAt(0).toUpperCase();
  const left = Math.max(0, u.left);
  const shipping = s.domesticShipping == null && s.intlShipping == null
    ? "Depop's rates"
    : [s.domesticShipping != null ? money(s.domesticShipping, s.currency) : "Depop's", s.intlShipping != null ? `${money(s.intlShipping, s.currency)} intl` : ''].filter(Boolean).join(' · ');

  return (
    <>
      <div className="set-acc">
        <span className="avatar">{me.avatar ? <img src={me.avatar} alt="" referrerPolicy="no-referrer" /> : initial}</span>
        <div style={{ flex: 1, minWidth: 0 }}><b>{me.name || 'Your account'}</b><span>{me.email}</span></div>
        <button type="button" className="chip" onClick={signOut} disabled={out}>{out ? <span className="spin" /> : 'Sign out'}</button>
      </div>

      <div className="set-lab">This month</div>
      <div className="set-box box quota-box">
        {u.admin ? (
          <>
            <div className="quota-n"><strong>No limit</strong></div>
            <div className="quota-foot"><span>Admin account</span><a className="chip" href="/admin" style={{ display: 'inline-grid', placeItems: 'center', textDecoration: 'none' }}>Admin dashboard</a></div>
          </>
        ) : (
          <>
            <div className="quota-n"><strong>{left}</strong>of {u.monthlyLimit} items left</div>
            <div className="quota-track" role="progressbar" aria-label="Items left this month" aria-valuemin={0} aria-valuemax={u.monthlyLimit} aria-valuenow={Math.min(left, u.monthlyLimit)}>
              <i style={{ width: `${Math.min(100, (Math.min(left, u.monthlyLimit) / u.monthlyLimit) * 100)}%` }} />
            </div>
            <div className="quota-foot"><span>Back to {u.monthlyLimit} on {refillDay(u.monthResets)}{u.bonusCredits > 0 ? ` · ${u.bonusCredits} extra that never run out` : ''}</span>{!packs.length && <AskButton usage={u} onUsage={usage => onSaved({ ...me, usage })} toast={toast} />}</div>
            {packs.length > 0 && (
              <div className="quota-packs">
                {packs.map(p => (
                  <button key={p.id} type="button" className="chip" onClick={() => buy(p.id)} disabled={Boolean(buying)}>
                    {buying === p.id ? <span className="spin" /> : `${p.listings} more · ${money(p.cents / 100, 'USD')}`}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="set-lab">Every export</div>
      <div className="set-box box">
        <button type="button" className="li" onClick={() => setPick('location')}><span className="li-k">Ships from</span><span className="li-v is-quiet"><span>{label(s.location)}</span><Next /></span></button>
        <button type="button" className="li" onClick={() => setPick('currency')}><span className="li-k">Currency</span><span className="li-v is-quiet"><span>{s.currency}</span><Next /></span></button>
        <button type="button" className="li" onClick={() => setShipOpen(true)}><span className="li-k">Shipping cost</span><span className="li-v is-quiet"><span>{shipping}</span><Next /></span></button>
      </div>

      <div className="set-lab">Look</div>
      <div className="seg" role="group" aria-label="Look">
        {THEMES.map(([t, name]) => <button key={t} type="button" aria-pressed={s.theme === t} onClick={() => setTheme(t)}>{name}</button>)}
      </div>

      <div className="set-lab">Help</div>
      <div className="set-box box">
        {APP_LINKS.contactEmail && <a className="li" href={`mailto:${APP_LINKS.contactEmail}`}><span className="li-k">Email support</span><span className="li-v is-quiet"><span>{APP_LINKS.contactEmail}</span></span></a>}
        {APP_LINKS.coffee && <a className="li" href={APP_LINKS.coffee} target="_blank" rel="noopener noreferrer"><span className="li-k">Buy me a coffee</span><span className="li-v is-quiet"><External /></span></a>}
      </div>
      <div className="set-legal"><a href="/privacy">Privacy</a><a href="/terms">Terms</a></div>
      <div style={{ height: 32 }} />

      {pick === 'location' && <PickerSheet title="Ships from" options={plainOptions(DEPOP_LOCATIONS)} value={s.location} search onPick={v => save({ location: v })} onClose={() => setPick(null)} />}
      {pick === 'currency' && <PickerSheet title="Currency" options={CURRENCIES.map(c => ({ value: c, label: c }))} value={s.currency} onPick={v => save({ currency: v })} onClose={() => setPick(null)} />}
      {shipOpen && <ShippingSheet domestic={s.domesticShipping} intl={s.intlShipping} currency={s.currency} onSave={(d, i) => save({ domesticShipping: d, intlShipping: i })} onClose={() => setShipOpen(false)} />}
    </>
  );
}
