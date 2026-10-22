'use client';
import { useEffect, useRef } from 'react';
import { Close } from './icons';

const stack: number[] = [];
let nextId = 1;
let stepping: Promise<void> | null = null;
function stepBack() {
  stepping = new Promise<void>(done => {
    const finished = () => { window.removeEventListener('popstate', finished); clearTimeout(t); stepping = null; done(); };
    const t = setTimeout(finished, 500);
    window.addEventListener('popstate', finished);
    window.history.back();
  });
}
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Sheet({ title, onClose, children, foot, className }: {
  title: string; onClose: () => void; children: React.ReactNode; foot?: React.ReactNode; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const id = nextId++;
    stack.push(id);
    const top = () => stack[stack.length - 1] === id;
    const prev = document.activeElement as HTMLElement | null;
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();

    let open = true, pushed = false;
    const onPop = () => { if (pushed && (window.history.state?.sheet ?? 0) < id) close.current(); };
    const push = () => {
      if (!open) return;
      window.history.pushState({ ...(window.history.state || {}), sheet: id }, '');
      pushed = true;
      window.addEventListener('popstate', onPop);
    };
    if (stepping) stepping.then(push); else push();

    const onKey = (e: KeyboardEvent) => {
      if (!top()) return;
      if (e.key === 'Escape') { e.stopPropagation(); close.current(); return; }
      if (e.key === 'Tab' && ref.current) {
        const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(x => x.offsetParent !== null);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      stack.splice(stack.indexOf(id), 1);
      document.removeEventListener('keydown', onKey);
      open = false;
      window.removeEventListener('popstate', onPop);
      if (pushed && window.history.state?.sheet === id) stepBack();
      if (!stack.length) document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, []);

  return (
    <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`sheet${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn sheet-close" onClick={onClose} aria-label="Close"><Close /></button>
        </div>
        <div className="sheet-body">{children}</div>
        {foot && <div className="sheet-foot">{foot}</div>}
      </div>
    </div>
  );
}
