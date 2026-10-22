const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const Check = () => (
  <svg viewBox="0 0 24 24" {...p} strokeWidth={3} aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
);
export const Close = () => (
  <svg viewBox="0 0 24 24" {...p} strokeWidth={2.4} aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const Down = () => (
  <svg viewBox="0 0 24 24" {...p} strokeWidth={2.2} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
);
export const Back = () => (
  <svg viewBox="0 0 24 24" {...p} strokeWidth={2.2} aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
);
export const Next = () => (
  <svg viewBox="0 0 24 24" {...p} strokeWidth={2.2} aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
);
export const More = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
);
export const Plus = () => (
  <svg viewBox="0 0 24 24" {...p} strokeWidth={2.2} aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
);
export const Download = () => (
  <svg viewBox="0 0 24 24" {...p} strokeWidth={2} aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
);
export const External = () => (
  <svg viewBox="0 0 24 24" {...p} strokeWidth={2.2} aria-hidden="true"><path d="M7 17L17 7M9 7h8v8" /></svg>
);
export const Pencil = () => (
  <svg viewBox="0 0 24 24" {...p} strokeWidth={2} aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>
);
export const Photos = () => (
  <svg viewBox="0 0 24 24" {...p} aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M21 16l-5-5-8 8" /></svg>
);
export const Google = () => (
  <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
);

export const SlotFront = () => (
  <svg viewBox="0 0 24 24" {...p} strokeWidth={1.6} aria-hidden="true"><path d="M8 3l-5 3 2 4 2-1v12h10V9l2 1 2-4-5-3c-1 2-2.5 3-4 3S9 5 8 3z" /></svg>
);
export const SlotBack = () => (
  <svg viewBox="0 0 24 24" {...p} strokeWidth={1.6} aria-hidden="true"><path d="M8 3l-5 3 2 4 2-1v12h10V9l2 1 2-4-5-3c-1 1.2-2.5 1.6-4 1.6S9 4.2 8 3z" /></svg>
);
export const SlotTag = () => (
  <svg viewBox="0 0 24 24" {...p} strokeWidth={1.6} aria-hidden="true"><path d="M5 4h14v16H5z" /><path d="M8 9h8M8 13h8M8 17h5" /></svg>
);
export const SlotMeasure = () => (
  <svg viewBox="0 0 24 24" {...p} strokeWidth={1.6} aria-hidden="true"><path d="M2 9h20v6H2z" /><path d="M6 9v3M10 9v2M14 9v3M18 9v2" /></svg>
);
