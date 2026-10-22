'use client';
import { money, type Listing } from '@/lib/client/api';

type Debug = NonNullable<Listing['debug']>;
type JComp = { title: string; price: number; currency: string; source: string; status: string; site?: string; url?: string; soldDate?: string; match?: string; brandNamed?: string };

export const cents = (c: number | null | undefined) =>
  c == null || !isFinite(c) ? '–' : `${c < 1 ? c.toFixed(2) : c.toFixed(1)}¢`;
const secs = (ms: number | undefined) => (ms == null ? '–' : `${(ms / 1000).toFixed(1)}s`);
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const ORDER: Record<string, number> = { same: 0, similar: 1, different: 2 };

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="dbg-row"><span className="dbg-k">{k}</span><span className="dbg-v">{children}</span></div>;
}

function Parts({ parts }: { parts?: Record<string, number> }) {
  const entries = Object.entries(parts || {});
  if (!entries.length) return <>–</>;
  return <>{entries.map(([k, v], i) => <span key={k}>{i > 0 && ' · '}{k} {cents(v)}</span>)}</>;
}

function Times({ t }: { t?: Record<string, number> }) {
  const entries = Object.entries(t || {});
  if (!entries.length) return <>–</>;
  return <>{entries.map(([k, v], i) => <span key={k}>{i > 0 && ' · '}{k} {secs(v)}</span>)}</>;
}

export function DebugPanel({ listing }: { listing: Listing }) {
  const d = listing.debug as Debug | undefined;
  if (!d) return null;
  const a = d.analysis || {};
  const runs = d.priceRuns || [];
  const last = runs[runs.length - 1] || null;
  const judged = ([...(last?.judged || [])] as JComp[]).sort((x, y) => (ORDER[x.match || 'different'] ?? 3) - (ORDER[y.match || 'different'] ?? 3));
  const before = (a.before || {}) as Record<string, string>;
  const r = d.read;
  const brandChanged = before.brand !== undefined && String(before.brand || '') !== String(r.brand || '');
  const counts = judged.reduce((m, c) => ({ ...m, [c.match || 'different']: (m[c.match || 'different'] || 0) + 1 }), {} as Record<string, number>);
  const errors = [...((a.errors as string[]) || []), ...(last?.errors || [])];

  return (
    <details className="debug">
      <summary>
        <span>Debug</span>
        <span className="dbg-sum">{cents(d.totalCents)} total<span className="dbg-chev">▾</span></span>
      </summary>

      {a.failed && <p className="dbg-error">Analysis failed: {String(a.failed)}</p>}
      {errors.length > 0 && (
        <div className="dbg-errors">{errors.map((e, i) => <p key={i}>{e}</p>)}</div>
      )}

      <section className="dbg-sec">
        <h4>Cost and time</h4>
        <Row k="Total">{cents(d.totalCents)}</Row>
        <Row k="Upload">{cents(a.cents)} (<Parts parts={a.parts} />)</Row>
        {runs.map((p, i) => (
          <Row key={i} k={i === 0 ? 'Price' : `Re-check ${i}`}>{cents(p.cents)} (<Parts parts={p.parts} />) · {when(p.at)}</Row>
        ))}
        {d.rewrites.length > 0 && <Row k="Rewrites">{d.rewrites.length} × · {cents(d.rewrites.reduce((s, x) => s + (Number(x.cents) || 0), 0))}</Row>}
        <Row k="Upload time"><Times t={a.timings} /></Row>
        {last && <Row k="Price time"><Times t={last.timings} /></Row>}
        {a.model && <Row k="Vision model">{String(a.model)}</Row>}
        {a.arranged && <Row k="Photo order">{arrangedText(a.arranged as Record<string, any>)}</Row>}
      </section>

      <section className="dbg-sec">
        <h4>What the AI read</h4>
        <Row k="Tag text">{r.tagText ? `“${r.tagText}”` : 'none'} ({r.tagLegibility || 'unknown'})</Row>
        <Row k="Brand">
          {brandChanged ? <><s>{before.brand || '(none)'}</s> → {r.brand || '(blank)'}</> : r.brand || '(blank)'}
        </Row>
        <Row k="Era">
          {r.dating ? `${r.dating.era || '–'} (from ${r.dating.confidence || '–'})` : '–'}
          {before.era && r.dating && before.era !== r.dating.era ? <> · AI first said <s>{before.era}</s></> : null}
          {r.age ? ` · Depop age: ${r.age}` : ' · no Depop age set'}
        </Row>
        {Array.isArray(r.dating?.basis) && r.dating.basis.length > 0 && <Row k="Dated by">{(r.dating.basis as string[]).join('; ')}</Row>}
        {r.evidence.length > 0 && <Row k="Evidence">{r.evidence.join('; ')}</Row>}
        {r.notVisible.length > 0 && <Row k="Not visible">{r.notVisible.join('; ')}</Row>}
        <Row k="Rule changes">{r.checks.length ? r.checks.join('; ') : 'none'}</Row>
        <Row k="Search">{r.searchQuery || '–'}{r.broadQuery ? ` · broad: ${r.broadQuery}` : ''}</Row>
        <Row k="AI's own price">{r.suggestedPrice != null ? money(r.suggestedPrice, listing.pricing?.currency || 'USD') : '–'}</Row>
        {Array.isArray(a.hints) && a.hints.length > 0 && (
          <Row k={`Look-alikes (${a.hints.length})`}>{(a.hints as string[]).join(' · ')}</Row>
        )}
      </section>

      {last && (
        <section className="dbg-sec">
          <h4>Price</h4>
          <Row k="Result">
            {money(last.price, listing.pricing?.currency || 'USD') || '–'} · {last.basis} · confidence {last.confidence ?? '–'}
          </Row>
          <Row k="Sources">
            {Object.entries(last.sources || {}).map(([k, v], i) => <span key={k}>{i > 0 && ' · '}{k} {String(v)}</span>)}
            {last.queries ? ` · web search ${last.queries.web ? 'on' : 'off'}` : ''}
          </Row>
          <Row k="Verdicts">same {counts.same || 0} · similar {counts.similar || 0} · different {counts.different || 0}</Row>
          {d.price.steps.length > 0 && (
            <ol className="dbg-steps">{d.price.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          )}
        </section>
      )}

      {judged.length > 0 && (
        <section className="dbg-sec">
          <h4>Every comp the judge saw ({judged.length})</h4>
          <ul className="dbg-comps">
            {judged.map((c, i) => (
              <li key={i} className={`m-${c.match || 'different'}`}>
                <span className="dbg-match">{c.match || 'different'}</span>
                <span className="dbg-title">
                  {c.url && /^https:\/\//.test(c.url) ? <a href={c.url} target="_blank" rel="noopener noreferrer">{c.title}</a> : c.title}
                  <small>{c.status} · {c.site || c.source}{c.soldDate ? ` · ${c.soldDate.replace(/^Sold\s*/i, '')}` : ''}{c.brandNamed ? ` · brand: ${c.brandNamed}` : ''}</small>
                </span>
                <span className="dbg-price">{money(c.price, c.currency)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="dbg-raw">
        <summary>Raw AI answer</summary>
        <pre>{JSON.stringify(d.ai, null, 2)}</pre>
      </details>
    </details>
  );
}

function arrangedText(x: Record<string, any>): string {
  const by: Record<string, string> = {
    seller: 'kept in the order uploaded', none: 'kept (sorting gave no answer)',
    quick: 'sorted by the quick pass', read: 'sorted from the main read',
  };
  const roles = Array.isArray(x.roles) && x.roles.length ? `: ${x.roles.join(', ')}` : '';
  const kept = !(x.by === 'quick' || x.by === 'read') || x.moved ? '' : x.changed ? ' (renaming failed, original order kept)' : ' (already in order)';
  return `${by[x.by] || String(x.by)}${roles}${kept}`;
}
