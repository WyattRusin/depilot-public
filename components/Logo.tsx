export const TAG_D_PATH = 'M31 16 H53 A34 34 0 0 1 53 84 H31 L11 64 V36 Z M35 40 A10 10 0 1 0 35 60 A10 10 0 1 0 35 40 Z';

export function TagMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <path d={TAG_D_PATH} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

export function Wordmark({ href = '/', onHome }: { href?: string; onHome?: () => void }) {
  return (
    <a className="word" href={href} aria-label="Depilot home"
      onClick={onHome ? e => { if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); onHome(); } } : undefined}>
      <TagMark />
      <span>Depilot</span>
    </a>
  );
}
