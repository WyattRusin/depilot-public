const DOTS = [6, 31, 36, 40, 44, 49, 57, 63, 94];

export function EmptyItem({ onFiles, disabled }: {
  onFiles: (files: FileList | null) => void; disabled?: boolean;
}) {
  const inner = (
    <>
      <span className="ghost-photo" />
      <span className="ghost-body" aria-hidden="true">
        <span className="ghost-top">
          <span><span className="gb" style={{ width: '72%' }} /><span className="gb is-sm" style={{ width: '44%' }} /></span>
          <span className="gb ghost-price" />
        </span>
        <span className="ghost-plot">
          <span className="gp-line" />
          <span className="gp-band" />
          {DOTS.map(x => <span key={x} className="gp-dot" style={{ left: `${x}%` }} />)}
        </span>
      </span>
    </>
  );
  return (
    <label className="ghost" aria-disabled={disabled || undefined} aria-label="New item">
      {inner}
      <input type="file" accept="image/*" multiple className="vh" disabled={disabled} onChange={e => { onFiles(e.target.files); e.target.value = ''; }} />
    </label>
  );
}

export function GhostRows({ n = 3 }: { n?: number }) {
  return (
    <ul className="list ghost-rows" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <li key={i} style={{ opacity: 0.8 - (i * 0.7) / n }}>
          <div className="row">
            <span className="thumb" />
            <span className="r-main"><span className="gb" style={{ width: `${66 - (i % 3) * 12}%` }} /><span className="gb is-sm" style={{ width: '36%' }} /></span>
            <span className="gb ghost-p" />
          </div>
        </li>
      ))}
    </ul>
  );
}
