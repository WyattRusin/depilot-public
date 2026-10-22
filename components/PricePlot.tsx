'use client';
import { useEffect, useRef, useState } from 'react';
import { money } from '@/lib/client/api';
import type { Plot } from '@/lib/client/items';

export function PricePlot({ plot, price, currency, onChange, onLive, onPickDot, selected, tag, readOnly }: {
  plot: Plot; price: number | null; currency: string;
  onChange?: (v: number) => void;
  onLive?: (v: number | null) => void;
  onPickDot?: (compIndex: number) => void;
  selected?: number | null; tag?: boolean; readOnly?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const active = useRef(false);
  const live = drag ?? price;
  useEffect(() => { setDrag(null); }, [price]);
  useEffect(() => { onLive?.(drag); }, [drag, onLive]);

  const valueAt = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    return Math.max(1, Math.round(plot.at(((clientX - r.left) / r.width) * 100)));
  };
  const commit = (v: number) => { if (onChange && v !== price) onChange(v); else setDrag(null); };
  const keyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<(() => void) | null>(null);
  const nudge = (v: number) => {
    setDrag(v);
    if (keyTimer.current) clearTimeout(keyTimer.current);
    pending.current = () => { pending.current = null; commit(v); };
    keyTimer.current = setTimeout(() => pending.current?.(), 450);
  };
  useEffect(() => () => { if (keyTimer.current) clearTimeout(keyTimer.current); pending.current?.(); }, []);

  const canDrag = !readOnly && Boolean(onChange) && live != null;
  return (
    <div className={`plot${canDrag ? '' : ' is-static'}`} ref={box}
      onPointerDown={e => {
        if (!canDrag || (e.target as HTMLElement).closest('.plot-dot')) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        active.current = true;
        setDrag(valueAt(e.clientX));
      }}
      onPointerMove={e => { if (active.current) setDrag(valueAt(e.clientX)); }}
      onPointerUp={e => { if (!active.current) return; active.current = false; commit(valueAt(e.clientX)); }}
      onPointerCancel={() => { active.current = false; setDrag(null); }}>
      <span className="plot-ax" />
      {plot.band && <span className="plot-band" style={{ left: `${plot.band[0]}%`, width: `${Math.max(2, plot.band[1] - plot.band[0])}%` }} />}
      {plot.points.map(pt => {
        const cls = `plot-dot${pt.sold ? '' : ' is-listed'}${selected === pt.i ? ' is-sel' : ''}`;
        const style = { left: `${pt.x}%`, top: `${30 - pt.lift * 12}px` };
        const name = `${pt.sold ? 'Sold' : 'For sale'} for ${money(pt.price, currency)}`;
        return onPickDot
          ? <button key={pt.i} type="button" className={cls} style={style} aria-label={name} onClick={() => onPickDot(pt.i)} />
          : <span key={pt.i} className={cls} style={style} title={name} />;
      })}
      {live != null && (
        <>
          <span className="plot-mk" style={{ left: `${plot.pos(live)}%` }} />
          {tag && <span className="plot-tag" style={{ left: `${plot.pos(live)}%` }}>Yours {money(live, currency)}</span>}
          {canDrag && (
            <button type="button" className="plot-hd" style={{ left: `${plot.pos(live)}%` }}
              role="slider" aria-label="Your price" aria-valuemin={Math.round(plot.min)} aria-valuemax={Math.round(plot.max)} aria-valuenow={live}
              aria-valuetext={money(live, currency)}
              onKeyDown={e => {
                const step = e.shiftKey ? 5 : 1;
                if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); nudge(live + step); }
                if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); nudge(Math.max(1, live - step)); }
              }} />
          )}
        </>
      )}
    </div>
  );
}
