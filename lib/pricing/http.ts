export class UpstreamError extends Error {
  retryable: boolean;
  status?: number;
  constructor(message: string, opts: { retryable?: boolean; status?: number } = {}) {
    super(message);
    this.retryable = opts.retryable ?? true;
    this.status = opts.status;
  }
}

export function httpsUrl(v: unknown): string | undefined {
  if (typeof v !== 'string' || v.length > 2000) return undefined;
  try { return new URL(v).protocol === 'https:' ? v : undefined; } catch { return undefined; }
}

export async function fetchJson(url: string, init: RequestInit, timeoutMs: number, label: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const data: any = await res.json().catch(() => ({}));
    return { res, data };
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new UpstreamError(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw new UpstreamError(`${label} failed: ${err?.message || err}`);
  } finally {
    clearTimeout(timer);
  }
}

export function redact(text: unknown, secrets: string[] = []): string {
  let out = String(text ?? '');
  for (const s of secrets) if (s && s.length >= 8) out = out.split(s).join('[redacted]');
  return out
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, '[redacted]')
    .replace(/([?&](?:key|token|access_token|api_key)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]{8,}/gi, '$1[redacted]');
}

export async function settle<T>(label: string, p: Promise<T>, timings: Record<string, number>, errors: string[]): Promise<T | null> {
  const t = Date.now();
  try {
    return await p;
  } catch (err: any) {
    errors.push(`${label}: ${redact(err?.message || err)}`);
    console.warn(`[pricing] ${label} failed:`, redact(err?.message || err));
    return null;
  } finally {
    timings[label] = Date.now() - t;
  }
}
