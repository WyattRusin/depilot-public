'use client';
import type { Listing } from '@/lib/client/api';
import { bucketOf, isStuck, metaOf, needOf, priceText } from '@/lib/client/items';
import { canPick, nameOf, sentNote, tabItems, type Pending, type Tab } from './Queue';
import { Check } from './icons';

export interface GridProps {
  listings: Listing[]; pending: Pending[]; currency: string; tab: Tab;
  pricing: Set<string>; priceFailed: Set<string>; retrying: Set<string>;
  selecting: boolean; chosen: Set<string>; onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onPendingRetry: (id: string) => void;
  onPendingDiscard: (id: string) => void;
  onRetry: (id: string) => void;
}

function noteOf(l: Listing, p: GridProps): { text: string; tone?: 'need' | 'bad' } {
  if (p.tab === 'sent') return { text: sentNote(l) };
  if (l.status === 'analyzing') return isStuck(l) ? { text: 'Didn’t finish reading', tone: 'bad' } : { text: '' };
  const n = needOf(l);
  if (n?.kind === 'size') return { text: 'Which size?', tone: 'need' };
  if (n?.kind === 'brand') return { text: 'Which brand?', tone: 'need' };
  if (n?.kind === 'fix') return { text: n.message, tone: 'bad' };
  return { text: metaOf(l) };
}

function Card({ l, p }: { l: Listing; p: GridProps }) {
  const reading = l.status === 'analyzing' && !isStuck(l);
  const pricingNow = l.status === 'pricing' && !(p.priceFailed.has(l.id) && !p.pricing.has(l.id));
  const ok = canPick(l);
  const picked = p.chosen.has(l.id);
  const note = noteOf(l, p);
  const failed = l.status === 'error' || (l.status === 'analyzing' && isStuck(l));
  return (
    <li className={failed && !p.selecting ? 'has-act' : undefined}>
      <button type="button" className={`card${p.selecting && picked ? ' is-picked' : ''}`} disabled={p.selecting && !ok}
        onClick={() => (p.selecting ? p.onToggle(l.id) : p.onOpen(l.id))} aria-pressed={p.selecting ? picked : undefined}>
        <span className="card-photo">
          {l.thumbs[0] ? <img src={l.thumbs[0]} alt="" loading="lazy" decoding="async" /> : null}
          {(reading || pricingNow) && <span className="card-state"><span className="spin" />{reading ? 'Reading' : 'Pricing'}</span>}
          {p.selecting && ok && <span className={`pick${picked ? ' is-on' : ''}`} aria-hidden="true">{picked && <Check />}</span>}
        </span>
        <span className="card-body">
          <span className="card-title">{reading ? <span className="skel" style={{ width: '80%', marginTop: 4 }} /> : nameOf(l)}</span>
          {failed && !p.selecting ? null : (
            <span className="card-foot">
              <span className={`card-note${note.tone ? ` is-${note.tone}` : ''}`}>{note.text}</span>
              <span className="card-price">{priceText(l, p.currency)}</span>
            </span>
          )}
        </span>
      </button>
      {failed && !p.selecting && (
        <span className="card-act">
          <button type="button" className="chip" onClick={() => p.onRetry(l.id)} disabled={p.retrying.has(l.id)}>{p.retrying.has(l.id) ? 'Reading' : 'Try again'}</button>
        </span>
      )}
    </li>
  );
}

function PendingCard({ x, p }: { x: Pending; p: GridProps }) {
  return (
    <li>
      <div className="card is-pending">
        <span className="card-photo">
          {x.previews[0] ? <img src={x.previews[0]} alt="" /> : null}
          {x.stage !== 'error' && <span className="card-state"><span className="spin" />{x.stage === 'uploading' ? 'Uploading' : 'Reading'}</span>}
        </span>
        <span className="card-body">
          {x.stage === 'error' ? (
            <>
              <span className="card-title">Couldn&apos;t upload</span>
              {x.error && <span className="card-note is-bad card-err">{x.error}</span>}
              <span className="card-foot" style={{ justifyContent: 'flex-start', gap: 6 }}>
                <button type="button" className="chip" onClick={() => p.onPendingRetry(x.id)}>Try again</button>
                <button type="button" className="chip is-quiet" onClick={() => p.onPendingDiscard(x.id)}>Remove</button>
              </span>
            </>
          ) : <span className="card-title"><span className="skel" style={{ width: '80%', marginTop: 4 }} /></span>}
        </span>
      </div>
    </li>
  );
}

export function Grid(p: GridProps) {
  const items = tabItems(p.listings, p.tab);
  if (p.tab === 'sent') {
    return <section className="grid-sec"><ul className="grid">{items.map(l => <Card key={l.id} l={l} p={p} />)}</ul></section>;
  }
  const groups: [string, Listing[]][] = [
    ['', items.filter(l => bucketOf(l) === 'working')],
    ['Needs you', items.filter(l => bucketOf(l) === 'needs')],
    ['Ready', items.filter(l => bucketOf(l) === 'ready')],
  ];
  return (
    <>
      {groups.map(([name, list], i) => {
        const pend = i === 0 && !p.selecting ? p.pending : [];
        if (!list.length && !pend.length) return null;
        return (
          <section key={i} className="grid-sec">
            {name && <div className="sec"><b>{name}</b><span>{list.length}</span></div>}
            <ul className="grid">
              {pend.map(x => <PendingCard key={x.id} x={x} p={p} />)}
              {list.map(l => <Card key={l.id} l={l} p={p} />)}
            </ul>
          </section>
        );
      })}
    </>
  );
}
