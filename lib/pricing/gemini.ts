import { UpstreamError, fetchJson } from './http.ts';
import type { CostMeter } from './cost.ts';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
export let BUSY_WAIT_MS = 2000;
export function setBusyWait(ms: number) { BUSY_WAIT_MS = ms; }

export type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

export interface GeminiRequest {
  apiKey: string;
  models: string[];
  system?: string;
  parts: Part[];
  schema?: object;
  googleSearch?: boolean;
  thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high';
  temperature?: number;
  timeoutMs?: number;
  deadline?: number;
  mediaResolution?: 'low' | 'medium' | 'high';
  meter?: CostMeter;
  meterLabel?: string;
}

export interface GeminiResult {
  text: string;
  json: any;
  model: string;
  sources: { uri: string; title: string }[];
  queries: string[];
  usage: { input: number; output: number; thoughts: number };
  ms: number;
}

export function extractJson(text: string): any {
  const t = text.trim();
  try { return JSON.parse(t); } catch {}
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch {} }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) { try { return JSON.parse(t.slice(start, end + 1)); } catch {} }
  return null;
}

const MEDIA = { low: 'MEDIA_RESOLUTION_LOW', medium: 'MEDIA_RESOLUTION_MEDIUM', high: 'MEDIA_RESOLUTION_HIGH' };

function buildBody(req: GeminiRequest, opts: { withSchema: boolean; withThinking: boolean; withMedia: boolean }) {
  const generationConfig: Record<string, unknown> = {};
  if (req.mediaResolution && opts.withMedia) generationConfig.mediaResolution = MEDIA[req.mediaResolution];
  if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
  if (req.schema && opts.withSchema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = req.schema;
  }
  if (req.thinkingLevel && opts.withThinking) generationConfig.thinkingConfig = { thinkingLevel: req.thinkingLevel };
  return {
    ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
    contents: [{ role: 'user', parts: req.parts }],
    ...(req.googleSearch ? { tools: [{ google_search: {} }] } : {}),
    generationConfig,
  };
}

async function callOnce(req: GeminiRequest, model: string, timeoutMs: number): Promise<GeminiResult> {
  const started = Date.now();
  let withSchema = true;
  let withThinking = true;
  let withMedia = true;

  for (let attempt = 0; attempt < 4; attempt++) {
    const { res, data } = await fetchJson(
      `${BASE}/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': req.apiKey },
        body: JSON.stringify(buildBody(req, { withSchema, withThinking, withMedia })),
      },
      timeoutMs,
      `Gemini ${model}`,
    );

    if (!res.ok) {
      const msg: string = data?.error?.message || `Gemini error ${res.status}`;
      if (res.status === 400 && withThinking && req.thinkingLevel && /thinking/i.test(msg)) { withThinking = false; continue; }
      if (res.status === 400 && withMedia && req.mediaResolution && /media|resolution/i.test(msg)) { withMedia = false; continue; }
      if (res.status === 400 && withSchema && req.schema && req.googleSearch && /schema|mime|json|tool/i.test(msg)) { withSchema = false; continue; }
      const retryable = res.status === 429 || res.status >= 500 || res.status === 404;
      throw new UpstreamError(`Gemini ${model} (${res.status}): ${msg}`, { retryable, status: res.status });
    }

    const cand = data?.candidates?.[0];
    const um = data?.usageMetadata || {};
    const usage = { input: um.promptTokenCount || 0, output: um.candidatesTokenCount || 0, thoughts: um.thoughtsTokenCount || 0 };
    req.meter?.gemini(req.meterLabel || 'gemini', model, usage);
    const text: string = (cand?.content?.parts || [])
      .filter((p: any) => typeof p.text === 'string' && !p.thought)
      .map((p: any) => p.text)
      .join('');
    if (!text) {
      const reason = cand?.finishReason || data?.promptFeedback?.blockReason;
      throw new UpstreamError(`The AI returned no usable output${reason ? ` (${reason})` : ''}. Try clearer photos.`, { retryable: false });
    }
    const json = req.schema || /^\s*[{[`]/.test(text) ? extractJson(text) : null;
    if (req.schema && !json) throw new UpstreamError('The AI returned malformed JSON', { retryable: true });

    const gm = cand?.groundingMetadata || {};
    return {
      text, json, model,
      sources: (gm.groundingChunks || []).map((c: any) => ({ uri: c?.web?.uri || '', title: c?.web?.title || '' })).filter((s: any) => s.uri || s.title),
      queries: gm.webSearchQueries || [],
      usage,
      ms: Date.now() - started,
    };
  }
  throw new UpstreamError('Gemini rejected the request settings', { retryable: false });
}

export async function generate(req: GeminiRequest): Promise<GeminiResult> {
  if (!req.apiKey) throw new UpstreamError('GEMINI_API_KEY is not set', { retryable: false });
  let lastErr: unknown;
  for (const model of req.models) {
    for (let tryNo = 0; tryNo < 2; tryNo++) {
      const left = req.deadline ? req.deadline - Date.now() : Infinity;
      if (left < 8000) return Promise.reject(lastErr instanceof Error ? lastErr : new UpstreamError('timed out: no time left'));
      try {
        return await callOnce(req, model, Math.min(req.timeoutMs ?? 45000, left - 1500));
      } catch (err) {
        lastErr = err;
        if (err instanceof UpstreamError && !err.retryable) throw err;
        const busy = err instanceof UpstreamError && (err.status === 429 || err.status === 503);
        if (busy && tryNo === 0) { await new Promise(r => setTimeout(r, BUSY_WAIT_MS)); continue; }
        console.warn(`[gemini] ${model} failed, trying next:`, (err as Error).message);
        break;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new UpstreamError('All Gemini models failed');
}
