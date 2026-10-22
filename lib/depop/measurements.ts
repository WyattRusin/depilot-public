export interface Measurement { name: string; value: string; unit: 'in' | 'cm' }

const MAX = 8;
const LINE_RE = /^measurements:.*$/gim;

export function normalizeMeasurements(raw: unknown): Measurement[] {
  if (!Array.isArray(raw)) return [];
  const out: Measurement[] = [];
  const seen = new Set<string>();
  for (const m of raw) {
    const name = String(m?.name ?? '').toLowerCase().replace(/[^a-z0-9 /&-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);
    const unit = String(m?.unit ?? '').toLowerCase().replace(/[^a-z]/g, '');
    const u: Measurement['unit'] | null = unit === 'in' || unit === 'inch' || unit === 'inches' ? 'in'
      : unit === 'cm' || unit === 'centimeters' || unit === 'centimetres' ? 'cm' : null;
    const num = Number(String(m?.value ?? '').replace(',', '.').replace(/[^0-9.]/g, ''));
    if (!name || !u || !isFinite(num) || num <= 0 || num > (u === 'in' ? 120 : 300)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, value: String(Math.round(num * 4) / 4), unit: u });
    if (out.length === MAX) break;
  }
  return out;
}

const fmt = (m: Measurement) => `${m.name} ${m.value}${m.unit === 'in' ? '"' : ' cm'}`;

export function measurementsLine(ms: Measurement[]): string {
  return ms.length ? `measurements: ${ms.map(fmt).join(' · ')}` : '';
}

export function applyMeasurementsLine(description: string, ms: Measurement[], signOff = 'dm any offers or questions.'): string {
  const line = measurementsLine(ms);
  const text = description.replace(/\r\n/g, '\n');
  if (LINE_RE.test(text)) {
    LINE_RE.lastIndex = 0;
    const replaced = line ? text.replace(LINE_RE, line) : text.replace(/^measurements:.*\n?/gim, '');
    return replaced.replace(/\n{3,}/g, '\n\n').trim();
  }
  if (!line) return text;
  const lines = text.split('\n');
  const after = lines.findIndex(l => /^fit:/i.test(l.trim()));
  if (after >= 0) { lines.splice(after + 1, 0, line); return lines.join('\n'); }
  const before = lines.findIndex(l => /^condition:/i.test(l.trim()));
  if (before >= 0) { lines.splice(before, 0, line); return lines.join('\n'); }
  const sign = lines.findIndex(l => l.trim().toLowerCase() === signOff);
  if (sign >= 0) { lines.splice(sign, 0, line, ''); return lines.join('\n'); }
  const tags = lines.findIndex(l => /^#\w/.test(l.trim()));
  if (tags >= 0) { lines.splice(tags, 0, line, ''); return lines.join('\n').replace(/\n{3,}/g, '\n\n'); }
  return `${text.trim()}\n\n${line}`;
}
