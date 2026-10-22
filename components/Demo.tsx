const SOLD = [98, 148, 158, 168, 176, 190, 200, 212, 228, 345];
const MIN = 95, MAX = 350, LOW = 150, HIGH = 240, PRICE = 185;
const at = (v: number) => ((v - MIN) / (MAX - MIN)) * 100;

export function DemoPlot() {
  let last = -10;
  const dots = SOLD.map(v => {
    const x = at(v);
    const lift = x - last < 3;
    if (!lift) last = x;
    return { x, lift };
  });
  return (
    <>
      <div className="plot is-static" style={{ height: 40, marginTop: 12 }}>
        <span className="plot-ax" style={{ top: 22 }} />
        <span className="plot-band" style={{ top: 14, left: `${at(LOW)}%`, width: `${at(HIGH) - at(LOW)}%` }} />
        {dots.map((d, i) => <span key={i} className="plot-dot" style={{ left: `${d.x}%`, top: d.lift ? 10 : 22 }} />)}
        <span className="plot-mk" style={{ left: `${at(PRICE)}%`, top: 2 }} />
      </div>
      <div className="plot-axl"><span>${MIN}</span><span>{SOLD.length} sold</span><span>${MAX}</span></div>
    </>
  );
}

export function DetroitJacket() {
  return (
    <svg className="demo-jacket" viewBox="40 22 320 206" aria-hidden="true" focusable="false">
      <defs>
      <pattern id="dj-cord" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(68)">
      <rect width="3" height="3" fill="#3F2C24"/><rect width="1.2" height="3" fill="#57412F"/>
      </pattern>
      <pattern id="dj-cordR" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(-68)">
      <rect width="3" height="3" fill="#3F2C24"/><rect width="1.2" height="3" fill="#57412F"/>
      </pattern>
      <pattern id="dj-cordH" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(90)">
      <rect width="3" height="3" fill="#3F2C24"/><rect width="1.2" height="3" fill="#57412F"/>
      </pattern>
      <linearGradient id="dj-body" x1="0" x2="1">
      <stop offset="0" stopColor="#8C5D32"/><stop offset=".2" stopColor="#9F6D3E"/><stop offset=".8" stopColor="#9F6D3E"/><stop offset="1" stopColor="#8C5D32"/>
      </linearGradient>
      </defs>
      <g fill="#966537" stroke="#6E4825" strokeWidth="1.2" strokeLinejoin="round">
      <path d="M134 54 Q116 60 107 78 L70 186 L110 199 L134 108 Z"/>
      <path d="M266 54 Q284 60 293 78 L330 186 L290 199 L266 108 Z"/>
      </g>
      <g fill="#8A5C31" stroke="#6E4825" strokeWidth="1.2" strokeLinejoin="round">
      <path d="M70 186 L110 199 L105 216 L65 203 Z"/>
      <path d="M330 186 L290 199 L295 216 L335 203 Z"/>
      </g>
      <g fill="#C9A253"><circle cx="97" cy="205.5" r="2.4"/><circle cx="303" cy="205.5" r="2.4"/></g>
      <path fill="url(#dj-body)" stroke="#6E4825" strokeWidth="1.2" strokeLinejoin="round"
      d="M170 38 L134 54 Q132 82 134 108 L139 186 L261 186 L266 108 Q268 82 266 54 L230 38 Q200 52 170 38 Z"/>
      <path fill="#8C5D32" stroke="#6E4825" strokeWidth="1.2" strokeLinejoin="round" d="M139 186 H261 V209 Q261 212 258 212 H142 Q139 212 139 209 Z"/>
      <g fill="#7C522B" stroke="#6E4825" strokeWidth="1"><rect x="141" y="191" width="21" height="14" rx="3"/><rect x="238" y="191" width="21" height="14" rx="3"/></g>
      <g fill="#C9A253"><circle cx="155" cy="198" r="2.4"/><circle cx="245" cy="198" r="2.4"/></g>
      <g fill="none" stroke="#CFA06A" strokeWidth=".8" strokeDasharray="2 1.8" opacity=".9">
      <path d="M142 189.5 H258"/><path d="M142 208.5 H258"/>
      <path d="M138 58 Q136 84 138 106"/><path d="M262 58 Q264 84 262 106"/>
      <path d="M73 189.5 L108 201"/><path d="M327 189.5 L292 201"/>
      <path d="M195.5 66 V185"/><path d="M204.5 66 V185"/>
      </g>
      <g fill="#7C522B" stroke="#6E4825" strokeWidth="1">
      <path d="M151 134 L156.5 132.5 L167 172 L161.5 173.5 Z"/>
      <path d="M249 134 L243.5 132.5 L233 172 L238.5 173.5 Z"/>
      </g>
      <path fill="#9A6839" stroke="#6E4825" strokeWidth="1.2" d="M214 92 H251 V126 Q251 129 248 129 H217 Q214 129 214 126 Z"/>
      <path fill="none" stroke="#CFA06A" strokeWidth=".8" strokeDasharray="2 1.8" d="M216.8 95 V126.4 H248.2 V95"/>
      <path stroke="#C9A253" strokeWidth="2.2" strokeLinecap="round" d="M218 98 H247"/>
      <rect x="243.5" y="97" width="3.6" height="7.5" rx="1.4" fill="#C9A253"/>
      <path stroke="#C9A253" strokeWidth="2.8" d="M200 64 V212"/>
      <path stroke="#A6823A" strokeWidth=".9" strokeDasharray="1 1.4" d="M200 64 V212"/>
      <rect x="197.2" y="68" width="5.6" height="12" rx="2" fill="#D4AE5E" stroke="#A6823A" strokeWidth=".7"/>
      <path fill="url(#dj-cordH)" stroke="#2C1F18" strokeWidth="1.1" strokeLinejoin="round" d="M169 33 Q200 45 231 33 L230 41 Q200 53 170 41 Z"/>
      <path fill="url(#dj-cord)" stroke="#2C1F18" strokeWidth="1.1" strokeLinejoin="round" d="M170 38 L152 52 L161 80 L197 64 Q182 58 171 44 Z"/>
      <path fill="url(#dj-cordR)" stroke="#2C1F18" strokeWidth="1.1" strokeLinejoin="round" d="M230 38 L248 52 L239 80 L203 64 Q218 58 229 44 Z"/>
    </svg>
  );
}

export function DemoItem({ className }: { className: string }) {
  return (
    <div className={className} aria-hidden="true">
      <div className="demo-photo"><DetroitJacket /></div>
      <div className={`${className}-body`}>
        <div className="demo-top">
          <div><b>Vintage Carhartt Detroit Jacket Brown Duck</b><span>Jackets · L · Used, good</span></div>
          <strong>${PRICE}</strong>
        </div>
        <DemoPlot />
      </div>
    </div>
  );
}
