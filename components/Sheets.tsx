'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Sheet } from './Sheet';
import { useTouchDevice } from './hooks';
import { PricePlot } from './PricePlot';
import { Check, External, Plus, Close, Download } from './icons';
import { label, isNoBrand, DEPOP_CATEGORY_LEAVES } from '@/lib/depop/data';
import { downloadText, money, type Listing } from '@/lib/client/api';
import { plotOf, titleOf, metaOf, priceText, needOf } from '@/lib/client/items';

export interface Option { value: string; label: string; group?: string }

export function PickerSheet({ title, options, value, onPick, onClose, none, search }: {
  title: string; options: Option[]; value: string; onPick: (v: string) => void; onClose: () => void;
  none?: string; search?: boolean;
}) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return k ? options.filter(o => o.label.toLowerCase().includes(k) || (o.group || '').toLowerCase().includes(k)) : options;
  }, [q, options]);
  const pick = (v: string) => { onPick(v); onClose(); };
  let lastGroup = '';
  return (
    <Sheet title={title} onClose={onClose}>
      {search && <input className="sheet-search" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} aria-label={`Search ${title.toLowerCase()}`} />}
      {none && !q && (
        <button type="button" className="opt opt-none" onClick={() => pick('')}>{none}{!value && <Check />}</button>
      )}
      {shown.map(o => {
        const head = o.group && o.group !== lastGroup ? <div className="opt-group">{o.group}</div> : null;
        if (o.group) lastGroup = o.group;
        return (
          <div key={o.value}>
            {head}
            <button type="button" className="opt" onClick={() => pick(o.value)} aria-pressed={o.value === value}>
              <span>{o.label}</span>{o.value === value && <Check />}
            </button>
          </div>
        );
      })}
    </Sheet>
  );
}

export const plainOptions = (list: string[]): Option[] => list.map(v => ({ value: v, label: label(v) }));

export const categoryOptions = (): Option[] => Object.entries(DEPOP_CATEGORY_LEAVES).flatMap(([group, leaves]) =>
  leaves.map(v => ({ value: v, label: label(v).split(' >> ').pop() || v, group: group.split(' >> ').join(' · ') })));

export function BrandSheet({ value, onPick, onClose }: { value: string; onPick: (v: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<string[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setList([]); return; }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      const r = await fetch(`/api/brands?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal }).then(x => x.json()).catch(() => null);
      if (r && !ctrl.signal.aborted) setList(r.brands || []);
    }, 140);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [q]);
  const pick = (v: string) => { onPick(v); onClose(); };
  return (
    <Sheet title="Brand" onClose={onClose}>
      <input className="sheet-search" autoFocus placeholder="Search brands" value={q} onChange={e => setQ(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && list[0]) pick(list[0]); }} aria-label="Search brands" />
      {!q && !isNoBrand(value) && <button type="button" className="opt" onClick={() => pick(value)}><span>{label(value)}</span><Check /></button>}
      {!q && <button type="button" className="opt opt-none" onClick={() => pick('')}>Other{isNoBrand(value) && <Check />}</button>}
      {list.map(b => <button key={b} type="button" className="opt" onClick={() => pick(b)}><span>{label(b)}</span>{b === value && <Check />}</button>)}
      {q.trim().length >= 2 && !list.length && <p className="sheet-sub" style={{ marginTop: 12 }}>No Depop brand by that name.</p>}
    </Sheet>
  );
}

type M = Listing['measurements'][number];
const NAMES = ['pit to pit', 'length', 'shoulder', 'sleeve', 'waist', 'inseam', 'rise', 'leg opening', 'hip', 'thigh'];

export function MeasureSheet({ value, onSave, onClose }: { value: M[]; onSave: (ms: M[]) => void; onClose: () => void }) {
  const [rows, setRows] = useState<M[]>(value.length ? value : [{ name: 'pit to pit', value: '', unit: 'in' }, { name: 'length', value: '', unit: 'in' }]);
  const set = (i: number, patch: Partial<M>) => setRows(r => r.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const save = () => { onSave(rows.filter(m => m.name.trim() && m.value.trim())); onClose(); };
  return (
    <Sheet title="Measurements" onClose={onClose}
      foot={<button type="button" className="btn btn-pri btn-block" onClick={save}>Save</button>}>
      <datalist id="measure-names">{NAMES.map(n => <option key={n} value={n} />)}</datalist>
      {rows.map((m, i) => (
        <div className="mrow" key={i}>
          <input list="measure-names" value={m.name} onChange={e => set(i, { name: e.target.value })} aria-label="What was measured" />
          <input inputMode="decimal" value={m.value} onChange={e => set(i, { value: e.target.value })} aria-label={`${m.name || 'Measurement'} value`} />
          <select value={m.unit} onChange={e => set(i, { unit: e.target.value as M['unit'] })} aria-label="Unit">
            <option value="in">in</option><option value="cm">cm</option>
          </select>
          <button type="button" className="icon-btn" onClick={() => setRows(r => r.filter((_, j) => j !== i))} aria-label={`Remove ${m.name || 'measurement'}`}><Close /></button>
        </div>
      ))}
      {rows.length < 8 && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRows(r => [...r, { name: '', value: '', unit: r[r.length - 1]?.unit || 'in' }])}>
          <Plus />Add
        </button>
      )}
    </Sheet>
  );
}

export interface MenuAction { label: string; sub?: string; danger?: boolean; confirm?: string; onClick: () => void; disabled?: boolean }

export function MenuSheet({ title, actions, onClose }: { title: string; actions: MenuAction[]; onClose: () => void }) {
  const [armed, setArmed] = useState<number | null>(null);
  return (
    <Sheet title={title} onClose={onClose} className="menu">
      {actions.map((a, i) => (
        <button key={a.label} type="button" className={`opt${a.danger ? ' is-bad' : ''}`} disabled={a.disabled}
          onClick={() => {
            if (a.confirm && armed !== i) { setArmed(i); return; }
            a.onClick(); onClose();
          }}>
          <span>{armed === i && a.confirm ? a.confirm : a.label}</span>{a.sub && <small>{a.sub}</small>}
        </button>
      ))}
    </Sheet>
  );
}

export function SalesSheet({ listing, currency, onRecheck, rechecking, onClose }: {
  listing: Listing; currency: string; onRecheck: () => void; rechecking: boolean; onClose: () => void;
}) {
  const p = listing.pricing!;
  const plot = plotOf(listing);
  const [sel, setSel] = useState<number | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const comps = p.comps || [];
  const sold = comps.filter(c => c.status === 'sold').length;
  const listed = comps.length - sold;
  const cur = p.currency || currency;
  const title = sold ? `${sold} sold` : listed ? `${listed} for sale now` : 'No matching sales';
  const pick = (i: number) => {
    setSel(i);
    list.current?.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const site = (c: (typeof comps)[number]) => c.site || (c.source === 'web' ? 'Web' : 'eBay');
  const when = (c: (typeof comps)[number]) => (c.soldDate || '').replace(/^Sold\s+/i, '').replace(/,\s*\d{4}$/, '');
  return (
    <Sheet title={sold && listed ? `${title}, ${listed} for sale` : title} onClose={onClose}
      foot={p.recheckLeft > 0 ? (
        <button type="button" className="btn btn-ghost btn-block" onClick={onRecheck} disabled={rechecking}>
          {rechecking && <span className="spin" />}{rechecking ? 'Checking prices' : 'Check prices again'}
        </button>
      ) : undefined}>
      {comps.length > 0 && <p className="sheet-sub">The same item{listing.fields?.size ? ', similar sizes' : ''}, from eBay{comps.some(c => c.site && c.site !== 'eBay') ? ' and others' : ''}</p>}
      {plot && (
        <div style={{ marginTop: 30 }}>
          <PricePlot plot={plot} price={listing.price} currency={cur} onPickDot={pick} selected={sel} tag readOnly />
          <div className="plot-axl"><span>{money(Math.round(plot.min), cur)}</span><span>{money(Math.round(plot.max), cur)}</span></div>
        </div>
      )}
      {comps.length > 0 && (
        <ul className="sales" ref={list}>
          {comps.map((c, i) => {
            const inner = (
              <>
                {c.image ? <img className="sale-img" src={c.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="sale-img">{site(c)}</span>}
                <span style={{ minWidth: 0 }}>
                  <span className="sale-t" style={{ display: 'block' }}>{c.title}</span>
                  <span className="sale-m" style={{ display: 'block' }}>{site(c)} · {c.status === 'sold' ? `sold${when(c) ? ` ${when(c)}` : ''}` : 'for sale now'}</span>
                </span>
                <span className="sale-p">{money(c.price, c.currency || cur)}</span>
              </>
            );
            const cls = `sale${c.status === 'sold' ? '' : ' is-listed'}${sel === i ? ' is-sel' : ''}`;
            return (
              <li key={i} data-i={i}>
                {c.url && /^https:\/\//.test(c.url) ? <a className={cls} href={c.url} target="_blank" rel="noopener noreferrer">{inner}</a> : <div className={cls}>{inner}</div>}
              </li>
            );
          })}
        </ul>
      )}
      {p.rejectedCount > 0 && <p className="sales-left">{p.rejectedCount} more left out: not the same item</p>}
      {!comps.length && <p className="sheet-sub" style={{ marginTop: 8 }}>{p.summary}</p>}
    </Sheet>
  );
}

export function ExportSheet({ items, location, currency, busy, onChangeLocation, onExport, onClose }: {
  items: Listing[]; location: string; currency: string; busy: boolean;
  onChangeLocation: () => void; onExport: (ids: string[]) => void; onClose: () => void;
}) {
  const [off, setOff] = useState<Set<string>>(new Set());
  const chosen = items.filter(l => !off.has(l.id));
  const total = chosen.reduce((a, l) => a + (l.price || 0), 0);
  const toggle = (id: string) => setOff(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Sheet title="Export to Depop" onClose={onClose}
      foot={(
        <>
          <div className="sum"><span>{chosen.length} of {items.length} item{items.length === 1 ? '' : 's'}</span>{total > 0 && <span>{money(Math.round(total), currency)} if all sell</span>}</div>
          <button type="button" className="btn btn-pri btn-block" disabled={!chosen.length || busy} onClick={() => onExport(chosen.map(l => l.id))}>
            {busy ? <span className="spin" /> : <Download />}Download for Depop
          </button>
        </>
      )}>
      <div className="ship"><span>Ships from <b>{label(location)}</b></span><button type="button" className="link" onClick={onChangeLocation}>Change</button></div>
      {items.map(l => {
        const n = needOf(l);
        return (
          <button key={l.id} type="button" className={`xrow${off.has(l.id) ? ' is-off' : ''}`} onClick={() => toggle(l.id)} aria-pressed={!off.has(l.id)}>
            <span className="cb"><Check /></span>
            {l.thumbs[0] ? <img src={l.thumbs[0]} alt="" /> : <span />}
            <span style={{ minWidth: 0 }}>
              <span className="t" style={{ display: 'block' }}>{titleOf(l)}</span>
              <span style={{ display: 'block', fontSize: 13, color: n ? 'var(--need)' : 'var(--ink-2)' }}>
                {n?.kind === 'size' ? 'No size' : n?.kind === 'brand' ? `Maybe ${label(n.suggestion)}?` : metaOf(l)}
              </span>
            </span>
            <span className="p">{priceText(l, currency)}</span>
          </button>
        );
      })}
    </Sheet>
  );
}

export interface ExportResult { files: { filename: string; csv?: string }[]; included: string[]; rejected: { id: string; title: string; errors: string[] }[] }

export const DEPOP_BULK_URL = 'https://www.depop.com/sellinghub/bulklisting/';

function copyNow(text: string): Promise<boolean> {
  let legacy = false;
  const active = document.activeElement as HTMLElement | null;
  try {
    const box = document.createElement('input');
    box.value = text;
    box.setAttribute('aria-hidden', 'true');
    box.contentEditable = 'true';
    Object.assign(box.style, { position: 'fixed', top: '0', left: '0', width: '1px', height: '1px', padding: '0', border: '0', fontSize: '16px', opacity: '0.01' });
    document.body.appendChild(box);
    box.focus({ preventScroll: true });
    box.select();
    box.setSelectionRange(0, text.length);
    legacy = document.execCommand('copy');
    box.remove();
  } catch {}
  active?.focus?.({ preventScroll: true });
  const modern = navigator.clipboard?.writeText
    ? navigator.clipboard.writeText(text).then(() => true, () => false)
    : Promise.resolve(false);
  return modern.then(ok => ok || legacy);
}

export function SentSheet({ result, listings, onClose }: { result: ExportResult; listings: Listing[]; onClose: () => void }) {
  const done = listings.filter(l => result.included.includes(l.id));
  const n = result.included.length;
  const touch = useTouchDevice();
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = () => {
    copyNow(DEPOP_BULK_URL).then(async ok => {
      if (!ok && navigator.share) {
        try { await navigator.share({ url: DEPOP_BULK_URL }); ok = true; } catch {}
      }
      setCopied(ok);
    });
  };
  return (
    <Sheet title={n ? `${n} item${n === 1 ? '' : 's'} ready for Depop` : 'Nothing exported'} onClose={onClose}
      foot={(
        <div style={{ display: 'grid', gap: 10 }}>
          {n > 0 && (touch ? (
            <button type="button" className="btn btn-pri btn-block" onClick={copy}>
              {copied ? <>Link copied<Check /></> : 'Copy Depop bulk listing link'}
            </button>
          ) : (
            <a className="btn btn-pri btn-block" href={DEPOP_BULK_URL} target="_blank" rel="noopener noreferrer">
              Open Depop bulk listing<External />
            </a>
          ))}
          <button type="button" className="btn btn-ghost btn-block" onClick={onClose}>Done</button>
        </div>
      )}>
      {n > 0 && (
        <>
          <div className="sent-thumbs">
            {done.slice(0, 6).map(l => (l.thumbs[0] ? <img key={l.id} src={l.thumbs[0]} alt="" /> : <span key={l.id} />))}
            {done.length > 6 && <span>+{done.length - 6}</span>}
          </div>
          {result.files.map((f, i) => (
            <div className="file" key={f.filename}>
              <span className="file-ic">{i === 0 ? <Check /> : <Download />}</span>
              <span style={{ flex: 1, minWidth: 0 }}><b>{f.filename}</b><span>{i === 0 ? 'Saved to your downloads' : 'Tap to save'}</span></span>
              {f.csv && (
                <button type="button" className="chip" onClick={() => downloadText(f.filename, f.csv!)}>{i === 0 ? 'Save again' : 'Download'}</button>
              )}
            </div>
          ))}
          {touch ? (
            <div className="phone-steps">
              <ol>
                <li><b>Copy the link</b> below and <b>paste it into your browser&apos;s address bar</b>. Tapping it would open the Depop app, which can&apos;t bulk list.</li>
                <li>On Depop, tap <b>Upload file</b> and choose {result.files.length > 1 ? 'each file' : 'this file'} from your downloads.</li>
              </ol>
              <input className="link-box" readOnly value={DEPOP_BULK_URL} aria-label="Depop bulk listing link"
                onFocus={e => e.currentTarget.setSelectionRange(0, DEPOP_BULK_URL.length)}
                onClick={e => e.currentTarget.setSelectionRange(0, DEPOP_BULK_URL.length)} />
              {copied === false && <p className="sheet-sub">Couldn&apos;t copy automatically. Tap the link above, then tap <b>Copy</b>.</p>}
              <p className="sheet-sub">Still opening the app, or the page won&apos;t load? Open the link on a computer, or turn on <b>Desktop site</b> in your browser&apos;s menu.</p>
            </div>
          ) : (
            <p className="next-step">On Depop, click <b>Upload file</b> and choose {result.files.length > 1 ? 'each file' : 'this file'} from your downloads.</p>
          )}
        </>
      )}
      {result.rejected.length > 0 && (
        <div className="box" style={{ marginTop: 16 }}>
          {result.rejected.map(r => (
            <div className="li" key={r.id}><span className="li-k" style={{ color: 'var(--ink)' }}>{r.title}</span><span className="li-v is-bad"><span>{r.errors[0]}</span></span></div>
          ))}
        </div>
      )}
    </Sheet>
  );
}

export function ShippingSheet({ domestic, intl, currency, onSave, onClose }: {
  domestic: number | null; intl: number | null; currency: string;
  onSave: (d: string, i: string) => void; onClose: () => void;
}) {
  const [d, setD] = useState(domestic == null ? '' : String(domestic));
  const [i, setI] = useState(intl == null ? '' : String(intl));
  return (
    <Sheet title="Shipping cost" onClose={onClose}
      foot={<button type="button" className="btn btn-pri btn-block" onClick={() => { onSave(d, i); onClose(); }}>Save</button>}>
      <div className="box">
        <label className="li"><span className="li-k">Domestic ({currency})</span>
          <input className="ship-input" inputMode="decimal" placeholder="Depop's" value={d} onChange={e => setD(e.target.value)} /></label>
        <label className="li"><span className="li-k">International ({currency})</span>
          <input className="ship-input" inputMode="decimal" placeholder="Depop's" value={i} onChange={e => setI(e.target.value)} /></label>
      </div>
    </Sheet>
  );
}
