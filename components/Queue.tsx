'use client';
import { label } from '@/lib/depop/data';
import type { Listing } from '@/lib/client/api';
import { bucketOf, isStuck, metaOf, needOf, priceText, shortDate, titleOf } from '@/lib/client/items';
import { Check } from './icons';

export interface Pending { id: string; previews: string[]; stage: 'uploading' | 'reading' | 'error'; error?: string }
export type Tab = 'list' | 'sent';

export interface QueueProps {
  listings: Listing[]; pending: Pending[]; currency: string;
  pricing: Set<string>; priceFailed: Set<string>; retrying: Set<string>;
  tab: Tab;
  selectedId?: string | null;
  selecting?: boolean; chosen?: Set<string>; onToggle?: (id: string) => void;
  onOpen: (id: string) => void;
  onPatch: (id: string, body: Record<string, unknown>) => void;
  onRetry: (id: string) => void;
  onRetryPrice: (id: string) => void;
  onDelete: (id: string) => void;
  onPendingRetry: (id: string) => void;
  onPendingDiscard: (id: string) => void;
  onMoreSizes: (l: Listing) => void;
  onMoreBrands: (l: Listing) => void;
}

export const canPick = (l: Listing) => !(l.status === 'analyzing' && !isStuck(l));

export function tabItems(listings: Listing[], tab: Tab): Listing[] {
  if (tab === 'sent') {
    return listings.filter(l => bucketOf(l) === 'sent')
      .sort((a, b) => Date.parse(b.exportedAt || b.createdAt) - Date.parse(a.exportedAt || a.createdAt));
  }
  const by = (b: string) => listings.filter(l => bucketOf(l) === b);
  return [...by('working'), ...by('needs'), ...by('ready')];
}

export const nameOf = (l: Listing) => (l.title ? titleOf(l)
  : l.status === 'error' ? 'Couldn’t read this item' : l.status === 'analyzing' && isStuck(l) ? 'Didn’t finish reading' : titleOf(l));

export const sentNote = (l: Listing) => (l.photosRemoved ? 'Photos removed' : l.exportedAt ? `Sent ${shortDate(l.exportedAt)}` : metaOf(l));

function Thumb({ src, dim, picked }: { src?: string; dim?: boolean; picked?: boolean | null }) {
  return (
    <span className={`thumb${dim ? ' is-dim' : ''}`}>
      {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : null}
      {picked != null && <span className={`pick${picked ? ' is-on' : ''}`} aria-hidden="true">{picked && <Check />}</span>}
    </span>
  );
}

export function Queue(p: QueueProps) {
  const items = tabItems(p.listings, p.tab);
  const on = (id: string) => (p.selectedId === id ? ' is-on' : '');

  if (p.selecting) {
    return (
      <ul className="list" style={{ marginTop: 10 }}>
        {items.map(l => {
          const ok = canPick(l);
          const picked = p.chosen?.has(l.id) || false;
          return (
            <li key={l.id}>
              <button type="button" className={`row is-pick${picked ? ' is-on' : ''}`} onClick={() => p.onToggle?.(l.id)}
                disabled={!ok} aria-pressed={picked}>
                <Thumb src={l.thumbs[0]} picked={ok ? picked : null} dim={!ok} />
                <span className="r-main"><span className="r-title">{nameOf(l)}</span>
                  <span className="r-meta">{!ok ? 'Reading' : p.tab === 'sent' ? sentNote(l) : metaOf(l)}</span></span>
                <span className="r-price">{priceText(l, p.currency)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  if (p.tab === 'sent') {
    return (
      <ul className="list" style={{ marginTop: 10 }}>
        {items.map(l => (
          <li key={l.id}>
            <button type="button" className={`row${on(l.id)}`} onClick={() => p.onOpen(l.id)}>
              <Thumb src={l.thumbs[0]} />
              <span className="r-main"><span className="r-title">{titleOf(l)}</span><span className="r-meta">{sentNote(l)}</span></span>
              <span className="r-price">{priceText(l, p.currency)}</span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  const working = items.filter(l => bucketOf(l) === 'working');
  const needs = items.filter(l => bucketOf(l) === 'needs');
  const ready = items.filter(l => bucketOf(l) === 'ready');

  const main = (l: Listing, meta: React.ReactNode, title = titleOf(l), wrap = false) => (
    <>
      <button type="button" className="row-btn" onClick={() => p.onOpen(l.id)} aria-label={`Open ${titleOf(l)}`} tabIndex={-1}>
        <Thumb src={l.thumbs[0]} />
      </button>
      <button type="button" className="row-btn r-main" onClick={() => p.onOpen(l.id)}>
        <span className="r-title">{title}</span>
        <span className={`r-meta${wrap ? ' is-wrap' : ''}`}>{meta}</span>
      </button>
    </>
  );

  return (
    <>
      {(p.pending.length > 0 || working.length > 0) && (
        <ul className="list" style={{ marginTop: 10 }}>
          {p.pending.map(x => (
            <li key={x.id} className="queue-enter">
              <div className="row" aria-busy={x.stage !== 'error'}>
                <Thumb src={x.previews[0]} dim />
                {x.stage === 'error' ? (
                  <>
                    <span className="r-main"><span className="r-title">Couldn&apos;t upload</span><span className="r-meta is-wrap r-bad">{x.error}</span></span>
                    <span />
                    <div className="r-ask">
                      <button type="button" className="chip" onClick={() => p.onPendingRetry(x.id)}>Try again</button>
                      <button type="button" className="chip is-quiet" onClick={() => p.onPendingDiscard(x.id)}>Remove</button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="r-main"><span className="skel" style={{ width: 170 }} /><span className="skel" style={{ width: 110, height: 10 }} /></span>
                    <span className="r-state" role="status"><span className="spin" />{x.stage === 'uploading' ? 'Uploading' : 'Reading'}</span>
                  </>
                )}
              </div>
            </li>
          ))}
          {working.map(l => {
            if (l.status === 'error') {
              return (
                <li key={l.id}>
                  <div className={`row${on(l.id)}`}>
                    {main(l, <span className="r-bad">{l.error || 'Something went wrong while reading the photos.'}</span>, l.title || 'Couldn’t read this item', true)}
                    <span />
                    <div className="r-ask">
                      <button type="button" className="chip" onClick={() => p.onRetry(l.id)} disabled={p.retrying.has(l.id)}>{p.retrying.has(l.id) ? 'Reading' : 'Try again'}</button>
                      <button type="button" className="chip is-quiet" onClick={() => p.onDelete(l.id)}>Delete</button>
                    </div>
                  </div>
                </li>
              );
            }
            if (l.status === 'analyzing') {
              const stuck = isStuck(l) && !p.retrying.has(l.id);
              return (
                <li key={l.id}>
                  <div className="row" aria-busy={!stuck}>
                    <Thumb src={l.thumbs[0]} dim />
                    {stuck ? (
                      <>
                        <span className="r-main"><span className="r-title">Didn&apos;t finish reading</span><span className="r-meta">{shortDate(l.createdAt)}</span></span>
                        <span />
                        <div className="r-ask">
                          <button type="button" className="chip" onClick={() => p.onRetry(l.id)}>Try again</button>
                          <button type="button" className="chip is-quiet" onClick={() => p.onDelete(l.id)}>Delete</button>
                        </div>
                      </>
                    ) : (
                      <>
                        <span className="r-main"><span className="skel" style={{ width: 170 }} /><span className="skel" style={{ width: 110, height: 10 }} /></span>
                        <span className="r-state" role="status"><span className="spin" />Reading</span>
                      </>
                    )}
                  </div>
                </li>
              );
            }
            const failed = p.priceFailed.has(l.id) && !p.pricing.has(l.id);
            return (
              <li key={l.id}>
                <div className={`row${on(l.id)}`}>
                  {main(l, metaOf(l))}
                  {failed
                    ? <span />
                    : <span className="r-state" role="status"><span className="spin" />Pricing</span>}
                  {failed && (
                    <div className="r-ask"><button type="button" className="chip" onClick={() => p.onRetryPrice(l.id)}>Get the price</button></div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {needs.length > 0 && (
        <>
          <div className="sec"><b>Needs you</b><span>{needs.length}</span></div>
          <ul className="list">
            {needs.map(l => {
              const n = needOf(l)!;
              return (
                <li key={l.id}>
                  <div className={`row${on(l.id)}`}>
                    {main(l, n.kind === 'size' ? <span className="r-q">Which size?</span>
                      : n.kind === 'brand' ? <span className="r-q">Which brand?</span>
                        : <span className="r-bad">{n.message}</span>)}
                    <span className="r-price">{priceText(l, p.currency)}</span>
                    {n.kind === 'size' && (
                      <div className="r-ask">
                        {n.options.map(s => <button key={s} type="button" className="chip" onClick={() => p.onPatch(l.id, { size: s })}>{label(s)}</button>)}
                        <button type="button" className="chip is-quiet" onClick={() => p.onMoreSizes(l)}>Other</button>
                      </div>
                    )}
                    {n.kind === 'brand' && (
                      <div className="r-ask">
                        <button type="button" className="chip" onClick={() => p.onPatch(l.id, { brand: n.suggestion })}>{label(n.suggestion)}</button>
                        {n.current
                          ? <button type="button" className="chip" onClick={() => p.onPatch(l.id, { brand: n.current })}>{label(n.current)}</button>
                          : <button type="button" className="chip" onClick={() => p.onPatch(l.id, { brand: '' })}>Other</button>}
                        <button type="button" className="chip is-quiet" onClick={() => p.onMoreBrands(l)}>Search</button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {ready.length > 0 && (
        <>
          <div className="sec"><b>Ready</b><span>{ready.length}</span></div>
          <ul className="list">
            {ready.map(l => (
              <li key={l.id}>
                <button type="button" className={`row${on(l.id)}`} onClick={() => p.onOpen(l.id)}>
                  <Thumb src={l.thumbs[0]} />
                  <span className="r-main"><span className="r-title">{titleOf(l)}</span><span className="r-meta">{metaOf(l)}</span></span>
                  <span className="r-price">{priceText(l, p.currency)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
