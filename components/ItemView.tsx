'use client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  DEPOP_AGES, DEPOP_COLORS, DEPOP_CONDITIONS, DEPOP_SOURCES, DEPOP_STYLES, label, isNoBrand,
} from '@/lib/depop/data';
import { allowedSizes, hasSizeField } from '@/lib/depop/sizes';
import { measurementsLine } from '@/lib/depop/measurements';
import type { DepopFields } from '@/lib/depop/fields';
import { money, type Listing } from '@/lib/client/api';
import {
  MAX_PHOTOS, SLOTS, SLOT_NAME, fullMetaOf, needOf, pathOf, plotOf, slotOf, titleOf, type Slot,
} from '@/lib/client/items';
import { PricePlot } from './PricePlot';
import { BrandSheet, MeasureSheet, MenuSheet, PickerSheet, SalesSheet, categoryOptions, plainOptions, type MenuAction, type Option } from './Sheets';
import { DebugPanel, cents } from './DebugPanel';
import { Back, More, Next, Pencil, Plus, SlotBack, SlotFront, SlotMeasure, SlotTag } from './icons';

const CONDITION_ORDER = ['brand_new', 'used_like_new', 'used_excellent', 'used_good', 'used_fair'];
const conditionRank = (v: string) => { const k = CONDITION_ORDER.findIndex(c => v.endsWith(`(${c})`)); return k === -1 ? 99 : k; };
const CONDITIONS_BEST_FIRST = DEPOP_CONDITIONS.slice().sort((a, b) => conditionRank(a) - conditionRank(b));

type Field = keyof DepopFields;

export function parsePriceInput(raw: string): number {
  let t = raw.replace(/[^0-9.,]/g, '');
  const comma = t.lastIndexOf(','), dot = t.lastIndexOf('.');
  if (comma > dot) t = t.length - comma - 1 <= 2 ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else t = t.replace(/,/g, '');
  return Number(t);
}
const SLOT_ICON: Record<Slot, () => React.ReactElement> = { front: SlotFront, back: SlotBack, tag: SlotTag, measure: SlotMeasure, more: Plus };

function fieldOf(msg: string): Field | 'photos' | 'location' | null {
  if (/category/i.test(msg)) return 'category';
  if (/condition/i.test(msg)) return 'condition';
  if (/size/i.test(msg)) return 'size';
  if (/brand/i.test(msg)) return 'brand';
  if (/description|hashtag/i.test(msg)) return 'description';
  if (/price/i.test(msg)) return 'price';
  if (/color 1/i.test(msg)) return 'color1';
  if (/color 2/i.test(msg)) return 'color2';
  if (/source 1/i.test(msg)) return 'source1';
  if (/source 2/i.test(msg)) return 'source2';
  if (/age/i.test(msg)) return 'age';
  if (/style 1/i.test(msg)) return 'style1';
  if (/style 2/i.test(msg)) return 'style2';
  if (/style 3/i.test(msg)) return 'style3';
  if (/location/i.test(msg)) return 'location';
  if (/photo/i.test(msg)) return 'photos';
  return null;
}

const PICKERS: Partial<Record<Field, { title: string; none?: string; options: (f: DepopFields) => Option[]; search?: boolean }>> = {
  size: { title: 'Size', none: 'No size', options: f => plainOptions(allowedSizes(f.category)) },
  condition: { title: 'Condition', options: () => plainOptions(CONDITIONS_BEST_FIRST) },
  category: { title: 'Category', options: () => categoryOptions(), search: true },
  color1: { title: 'Colour', none: 'None', options: () => plainOptions(DEPOP_COLORS) },
  color2: { title: 'Second colour', none: 'None', options: () => plainOptions(DEPOP_COLORS) },
  age: { title: 'Era', none: 'Not sure', options: () => plainOptions(DEPOP_AGES) },
  source1: { title: 'Source', none: 'None', options: () => plainOptions(DEPOP_SOURCES) },
  source2: { title: 'Second source', none: 'None', options: () => plainOptions(DEPOP_SOURCES) },
  style1: { title: 'Style', none: 'None', options: () => plainOptions(DEPOP_STYLES), search: true },
  style2: { title: 'Second style', none: 'None', options: () => plainOptions(DEPOP_STYLES), search: true },
  style3: { title: 'Third style', none: 'None', options: () => plainOptions(DEPOP_STYLES), search: true },
};

const categoryText = (c: string) => {
  const parts = label(c).split(' >> ');
  return parts.length > 1 ? `${parts[0]} · ${parts[parts.length - 1]}` : parts[0];
};

export interface ItemHandlers {
  onPatch: (body: Record<string, unknown>) => void;
  onPhoto: (file: File, slot: Slot, replacePath?: string) => void;
  onRemovePhoto: (path: string) => void;
  onCover: (path: string) => void;
  onRecheck: () => void;
  onRewrite: () => void;
  onDelete: () => void;
  onRetry: () => void;
  onRetryPrice: () => void;
  onCopy: (text: string) => void;
  onShipping: () => void;
}

export function ItemView({ listing: l, currency, variant, busy, priceFailed, rewriting, retrying, uploading, onBack, next, onNext, ...h }: ItemHandlers & {
  listing: Listing; currency: string; variant: 'page' | 'pane';
  busy: boolean; priceFailed: boolean; rewriting: boolean; retrying: boolean; uploading: Set<string>;
  onBack?: () => void; next?: Listing | null; onNext?: () => void;
}) {
  const f = l.fields;
  const cur = l.pricing?.currency || currency;
  const [pick, setPick] = useState<Field | null>(null);
  const [brandOpen, setBrandOpen] = useState(false);
  const [measureOpen, setMeasureOpen] = useState(false);
  const [menu, setMenu] = useState<null | { title: string; actions: MenuAction[] }>(null);
  const [salesOpen, setSalesOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [photo, setPhoto] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const [editTitle, setEditTitle] = useState(false);
  const [editPrice, setEditPrice] = useState(false);
  const [live, setLive] = useState<number | null>(null);
  const [desc, setDesc] = useState(l.description);
  const track = useRef<HTMLDivElement>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const slotTarget = useRef<{ slot: Slot; replace?: string } | null>(null);

  useEffect(() => { setDesc(l.description); }, [l.description]);

  const typedTitle = useRef<string | null>(null);
  const sentDesc = useRef(l.description);
  const saveDesc = (v: string) => { if (v !== l.description && v !== sentDesc.current) { sentDesc.current = v; h.onPatch({ description: v }); } };
  const flush = useRef(() => {});
  flush.current = () => {
    saveDesc(desc);
    const t = typedTitle.current?.trim();
    if (t && t !== titleOf(l)) h.onPatch({ title: t });
  };
  useEffect(() => () => flush.current(), []);
  useEffect(() => { setPhoto(0); setMore(false); setEditTitle(false); setEditPrice(false); track.current?.scrollTo({ left: 0 }); }, [l.id]);
  useLayoutEffect(() => {
    const t = descRef.current;
    if (t) { t.style.height = 'auto'; t.style.height = `${t.scrollHeight + 2}px`; }
  }, [desc, l.id]);
  useEffect(() => {
    if (variant !== 'page') return;
    const on = () => setScrolled(window.scrollY > 300);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, [variant]);

  const plot = useMemo(() => plotOf(l), [l]);
  const need = needOf(l);
  const comps = l.pricing?.comps || [];
  const sold = comps.filter(c => c.status === 'sold').length;
  const forSale = comps.length - sold;
  const price = live ?? l.price;
  const ready = l.status === 'ready';
  const pricingNow = l.status === 'pricing' || busy;

  const photos = l.photos.map((url, i) => ({ url, thumb: l.thumbs[i] || url, slot: slotOf(url), path: pathOf(url) }));
  const labelled = photos.some(x => x.slot);
  const missing = labelled ? SLOTS.filter(s => !photos.some(x => x.slot === s.key)).map(s => s.key as Slot) : [];
  const canAdd = !l.photosRemoved && photos.length < MAX_PHOTOS && l.status !== 'analyzing';
  const choose = (slot: Slot, replace?: string) => {
    slotTarget.current = { slot, replace };
    fileIn.current?.click();
  };
  const goPhoto = (i: number) => {
    setPhoto(i);
    const t = track.current;
    if (t) t.scrollTo({ left: t.clientWidth * i, behavior: 'smooth' });
  };
  const photoMenu = (i: number) => {
    const x = photos[i];
    const name = x.slot ? SLOT_NAME[x.slot] : `Photo ${i + 1}`;
    setMenu({
      title: name,
      actions: [
        ...(i > 0 ? [{ label: 'Make cover', onClick: () => { h.onCover(x.path); goPhoto(0); } }] : []),
        { label: 'Retake', onClick: () => choose(x.slot || 'more', x.path) },
        ...(photos.length > 1 ? [{ label: 'Remove photo', danger: true, onClick: () => h.onRemovePhoto(x.path) }] : []),
      ],
    });
  };

  const openMenu = () => setMenu({
    title: titleOf(l),
    actions: [
      { label: 'Copy listing', onClick: () => h.onCopy(l.description) },
      ...(l.price != null ? [{ label: 'Copy price', onClick: () => h.onCopy(String(l.price)) }] : []),
      ...(ready && l.rewritesLeft > 0 ? [{ label: rewriting ? 'Rewriting description' : 'Rewrite description', sub: l.rewritesLeft < 99 ? `${l.rewritesLeft} left` : undefined, disabled: rewriting, onClick: h.onRewrite }] : []),
      ...(ready && l.pricing && l.pricing.recheckLeft > 0 ? [{ label: 'Check prices again', sub: l.pricing.recheckLeft < 99 ? `${l.pricing.recheckLeft} left` : undefined, disabled: busy, onClick: h.onRecheck }] : []),
      { label: 'Delete item', danger: true, confirm: 'Tap again to delete', onClick: h.onDelete },
    ],
  });

  const openField = (k: Field | 'photos' | 'location' | null) => {
    if (!k) return;
    if (k === 'brand') setBrandOpen(true);
    else if (k === 'description') descRef.current?.focus();
    else if (k === 'price') setEditPrice(true);
    else if (k === 'location') h.onShipping();
    else if (k === 'photos') { if (canAdd) choose(missing[0] || 'more'); }
    else if (PICKERS[k]) setPick(k);
  };
  const row = (k: Field, name: string, value: string, opts: { empty?: string; tone?: 'need' | 'bad' } = {}) => (
    <button key={k} type="button" className="li" onClick={() => openField(k)}>
      <span className="li-k">{name}</span>
      <span className={`li-v${!value ? ` is-${opts.tone || 'quiet'}` : ''}`}><span>{value || opts.empty || 'None'}</span><Next /></span>
    </button>
  );

  const titleBlock = editTitle ? (
    <input className="ititle-input" autoFocus defaultValue={titleOf(l)} aria-label="Title" maxLength={80}
      onChange={e => { typedTitle.current = e.target.value; }}
      onKeyDown={e => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') { typedTitle.current = null; setEditTitle(false); }
      }}
      onBlur={e => { const v = e.target.value.trim(); typedTitle.current = null; setEditTitle(false); if (v && v !== titleOf(l)) h.onPatch({ title: v }); }} />
  ) : (
    <button type="button" className="ititle" onClick={() => f && setEditTitle(true)} disabled={!f} aria-label={`Rename ${titleOf(l)}`}>
      {l.status === 'analyzing' ? 'Reading the photos' : l.status === 'error' ? 'Couldn’t read this item' : titleOf(l)}{f && <Pencil />}
    </button>
  );

  const priceBlock = !f ? null : pricingNow ? (
    <div className="price-wait" role="status"><span className="spin" />Pricing</div>
  ) : priceFailed && !l.pricing?.confidenceLabel ? (
    <div className="price-row"><button type="button" className="btn btn-ghost btn-sm" onClick={h.onRetryPrice}>Get the price</button></div>
  ) : (
    <>
      <div className="price-row">
        {editPrice ? (
          <input className="price-input" autoFocus inputMode="decimal" defaultValue={l.price ?? ''} aria-label="Price"
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditPrice(false); }}
            onBlur={e => {
              setEditPrice(false);
              const n = parsePriceInput(e.target.value);
              if (e.target.value.trim() && isFinite(n) && n > 0 && n !== l.price) h.onPatch({ price: n });
            }} />
        ) : (
          <button type="button" className={`price-big${price == null ? ' is-none' : ''}`} onClick={() => setEditPrice(true)} aria-label="Change price">
            {price != null ? money(price, cur) : 'Set a price'}
          </button>
        )}
        <span className="price-side">
          {l.pricing?.userPriced && l.pricing.price != null && l.pricing.price !== l.price
            ? <button type="button" className="link" onClick={() => h.onPatch({ price: l.pricing!.price })}>Use {money(l.pricing.price, cur)}</button>
            : l.pricing?.low != null && l.pricing.high != null
              ? <>Most sell for {money(l.pricing.low, cur)}–{money(l.pricing.high, cur).replace(/^[^0-9]+/, '')}</>
              : l.pricing?.basis === 'estimate' ? 'Estimate' : null}
        </span>
      </div>
      {plot && <PricePlot plot={plot} price={l.price} currency={cur} onChange={v => h.onPatch({ price: v })} onLive={setLive} />}
      <div className="plot-axl">
        <span>{plot ? money(Math.round(plot.min), cur) : ''}</span>
        {comps.length > 0
          ? <button type="button" className="link" onClick={() => setSalesOpen(true)}>{sold ? `${sold} sold` : ''}{sold && forSale ? ' · ' : ''}{forSale ? `${forSale} for sale` : ''}<Next /></button>
          : l.pricing ? <button type="button" className="link" style={{ color: 'var(--ink-2)', fontWeight: 500 }} onClick={() => setSalesOpen(true)}>No matching sales</button> : <span />}
        <span>{plot ? money(Math.round(plot.max), cur) : ''}</span>
      </div>
    </>
  );

  const askBlock = need && need.kind !== 'fix' ? (
    <div className="iask">
      <b>{need.kind === 'size' ? 'Which size?' : 'Which brand?'}</b>
      <div className="chips">
        {need.kind === 'size' && need.options.map(s => <button key={s} type="button" className="chip" onClick={() => h.onPatch({ size: s })}>{label(s)}</button>)}
        {need.kind === 'size' && <button type="button" className="chip is-quiet" onClick={() => setPick('size')}>Other</button>}
        {need.kind === 'brand' && (
          <>
            <button type="button" className="chip" onClick={() => h.onPatch({ brand: need.suggestion })}>{label(need.suggestion)}</button>
            {need.current
              ? <button type="button" className="chip" onClick={() => h.onPatch({ brand: need.current })}>{label(need.current)}</button>
              : <button type="button" className="chip" onClick={() => h.onPatch({ brand: '' })}>Other</button>}
            <button type="button" className="chip is-quiet" onClick={() => setBrandOpen(true)}>Search</button>
          </>
        )}
      </div>
    </div>
  ) : null;

  const errors = ready && f && l.validation?.errors.length ? (
    <div className="box" style={{ marginTop: 14 }}>
      {l.validation.errors.map(m => (
        <button key={m} type="button" className="li" onClick={() => openField(fieldOf(m))}>
          <span className="li-v is-bad" style={{ textAlign: 'left' }}><span style={{ whiteSpace: 'normal' }}>{m}</span></span><Next />
        </button>
      ))}
    </div>
  ) : null;

  const statusBlock = l.status === 'error' ? (
    <div className="ierror" role="alert">
      {l.error || 'Something went wrong reading these photos.'}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-pri btn-sm" onClick={h.onRetry} disabled={retrying}>{retrying && <span className="spin" />}{retrying ? 'Reading' : 'Try again'}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={h.onDelete}>Delete</button>
      </div>
    </div>
  ) : l.status === 'analyzing' ? (
    <div className="price-wait" role="status"><span className="spin" />Reading</div>
  ) : null;

  const details = f && l.status !== 'error' && l.status !== 'analyzing' ? (
    <>
      <div className="isec"><b>Description</b><button type="button" className="link" onClick={() => h.onCopy(desc)}>Copy</button></div>
      <textarea ref={descRef} className="desc" value={desc} rows={6} aria-label="Description"
        onChange={e => setDesc(e.target.value)}
        onBlur={() => saveDesc(desc)} />
      {desc.length > 900 && <div className={`desc-count${desc.length > 1000 ? ' is-bad' : ''}`}>{desc.length} / 1000</div>}

      <div className="isec"><b>Details</b></div>
      <div className={`box${variant === 'pane' ? ' kv' : ''}`}>
        {hasSizeField(f.category) && row('size', 'Size', label(f.size), { empty: 'Add', tone: 'need' })}
        {row('condition', 'Condition', label(f.condition), { empty: 'Add', tone: 'bad' })}
        <button type="button" className="li" onClick={() => setBrandOpen(true)}>
          <span className="li-k">Brand</span>
          <span className={`li-v${isNoBrand(f.brand) ? ' is-quiet' : ''}`}><span>{isNoBrand(f.brand) ? 'Other' : label(f.brand)}</span><Next /></span>
        </button>
        {row('category', 'Category', f.category ? categoryText(f.category) : '', { empty: 'Add', tone: 'bad' })}
        {row('color1', 'Colour', label(f.color1))}
        {f.age && row('age', 'Era', label(f.age))}
        <button type="button" className="li" onClick={() => setMeasureOpen(true)}>
          <span className="li-k">Measurements</span>
          <span className={`li-v${l.measurements.length ? '' : ' is-quiet'}`}>
            <span>{l.measurements.length ? measurementsLine(l.measurements).replace(/^measurements:\s*/, '') : 'Add'}</span>
            {l.measurements.length ? <Next /> : <Plus />}
          </span>
        </button>
        {!more && (
          <button type="button" className="li" onClick={() => setMore(true)} aria-expanded={false}>
            <span className="li-k">More details</span>
            <span className="li-v is-quiet"><span>{[f.color2 && 'colour', (f.source1 || f.source2) && 'source', (f.style1 || f.style2 || f.style3) && 'style'].filter(Boolean).join(', ') || 'Style, source'}</span><Next /></span>
          </button>
        )}
        {more && (
          <>
            {row('color2', 'Second colour', label(f.color2))}
            {!f.age && row('age', 'Era', label(f.age), { empty: 'Not sure' })}
            {row('source1', 'Source', label(f.source1))}
            {row('source2', 'Second source', label(f.source2))}
            {row('style1', 'Style', label(f.style1))}
            {row('style2', 'Second style', label(f.style2))}
            {row('style3', 'Third style', label(f.style3))}
          </>
        )}
      </div>
      {l.debug && <DebugPanel listing={l} />}
    </>
  ) : l.debug ? <DebugPanel listing={l} /> : null;

  const gallery = l.photosRemoved || !photos.length ? (
    <div className="gallery"><div className="gallery-gone">{l.photosRemoved ? 'Photos removed' : ''}</div></div>
  ) : (
    <div className="gallery">
      <div className="gallery-track" ref={track}
        onScroll={e => { const t = e.currentTarget; setPhoto(Math.round(t.scrollLeft / Math.max(1, t.clientWidth))); }}>
        {photos.map((x, i) => <img key={x.url} src={x.url} alt={i === 0 ? titleOf(l) : x.slot ? SLOT_NAME[x.slot] : `Photo ${i + 1}`} loading={i === 0 ? 'eager' : 'lazy'} decoding="async" />)}
      </div>
    </div>
  );

  const slots = !l.photosRemoved && photos.length > 0 ? (
    <div className="slots">
      {photos.map((x, i) => (
        <button key={x.url} type="button" className={`slot${i === photo ? ' is-cur' : ''}${uploading.has(x.path) ? ' is-busy' : ''}`}
          onClick={() => (i === photo ? photoMenu(i) : goPhoto(i))} aria-label={x.slot ? SLOT_NAME[x.slot] : `Photo ${i + 1}`}>
          <span className="slot-f"><img src={x.thumb} alt="" /></span>{x.slot ? SLOT_NAME[x.slot] : `Photo ${i + 1}`}
        </button>
      ))}
      {canAdd && (labelled ? missing : ['more' as Slot]).map(s => {
        const Icon = SLOT_ICON[s];
        const busySlot = uploading.has(`${l.id}:${s}`);
        return (
          <button key={s} type="button" className={`slot is-empty${busySlot ? ' is-busy' : ''}`} onClick={() => choose(s)} disabled={busySlot}
            aria-label={`Add ${s === 'more' ? 'a photo' : `the ${SLOT_NAME[s].toLowerCase()} photo`}`}>
            <span className="slot-f">{busySlot ? <span className="spin" /> : <Icon />}</span>{s === 'more' ? 'Add' : SLOT_NAME[s]}
          </button>
        );
      })}
    </div>
  ) : null;

  const sheets = (
    <>
      <input ref={fileIn} type="file" accept="image/*" hidden
        onChange={e => {
          const file = e.target.files?.[0];
          const t = slotTarget.current;
          if (file && t) h.onPhoto(file, t.slot, t.replace);
          e.target.value = '';
        }} />
      {pick && f && PICKERS[pick] && (
        <PickerSheet title={PICKERS[pick]!.title} options={PICKERS[pick]!.options(f)} value={String(f[pick] ?? '')} none={PICKERS[pick]!.none}
          search={PICKERS[pick]!.search} onPick={v => h.onPatch({ [pick]: v })} onClose={() => setPick(null)} />
      )}
      {brandOpen && f && <BrandSheet value={f.brand} onPick={v => h.onPatch({ brand: v })} onClose={() => setBrandOpen(false)} />}
      {measureOpen && <MeasureSheet value={l.measurements} onSave={ms => h.onPatch({ measurements: ms })} onClose={() => setMeasureOpen(false)} />}
      {menu && <MenuSheet title={menu.title} actions={menu.actions} onClose={() => setMenu(null)} />}
      {salesOpen && l.pricing && <SalesSheet listing={l} currency={currency} onRecheck={h.onRecheck} rechecking={busy} onClose={() => setSalesOpen(false)} />}
    </>
  );

  const head = (
    <>
      {titleBlock}
      <div className="imeta">{fullMetaOf(l)}{l.debug && <> · <span className="cost-chip" title="What this listing cost to make">{cents(l.debug.totalCents)}</span></>}</div>
      {statusBlock}
      {askBlock}
      {errors}
      {priceBlock}
    </>
  );

  if (variant === 'pane') {
    return (
      <div className="dpane">
        <div className="dpane-photos">{gallery}{slots}</div>
        <div className="ibody" style={{ minWidth: 0 }}>
          <div className="dpane-head">
            <div style={{ flex: 1, minWidth: 0 }}>{titleBlock}</div>
            <button type="button" className="icon-btn" onClick={openMenu} aria-label="More actions" style={{ boxShadow: 'inset 0 0 0 1px var(--line-2)' }}><More /></button>
          </div>
          <div className="imeta">{fullMetaOf(l)}{l.debug && <> · <span className="cost-chip">{cents(l.debug.totalCents)}</span></>}</div>
          {statusBlock}{askBlock}{errors}{priceBlock}{details}
        </div>
        {sheets}
      </div>
    );
  }

  return (
    <>
      <div className={`itop${scrolled ? ' is-scrolled' : ''}`}>
        <button type="button" className="back" onClick={onBack} aria-label="Back to items"><Back />{!scrolled && 'Items'}</button>
        <div className="itop-mini" aria-hidden={!scrolled}>
          {l.thumbs[0] && <img src={l.thumbs[0]} alt="" />}<span>{titleOf(l)}</span>{l.price != null && <b>{money(l.price, cur)}</b>}
        </div>
        <button type="button" className="icon-btn" onClick={openMenu} aria-label="More actions"><More /></button>
      </div>
      <main className="page">
        {gallery}
        {slots}
        <div className="ibody">
          {head}
          {details}
          <div className="i-end" />
        </div>
      </main>
      <div className="dock">
        {next
          ? <button type="button" className="btn btn-pri" onClick={onNext}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>Next: {titleOf(next)}</span><Next /></button>
          : <button type="button" className="btn btn-ghost" onClick={onBack}>Back to items</button>}
      </div>
      {sheets}
    </>
  );
}
