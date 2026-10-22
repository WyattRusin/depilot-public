'use client';
import type { ClientListing } from '@/lib/server/service';

export type Listing = ClientListing;

export type Theme = 'light' | 'dark' | 'system';

export interface Usage {
  month: number; monthlyLimit: number;
  bonusCredits: number; left: number; paused: boolean; monthResets: string;
  admin: boolean; askedForMore: boolean;
}
export interface Me {
  id: string;
  email: string | null; name: string | null; avatar: string | null;
  settings: { location: string; currency: string; domesticShipping: number | null; intlShipping: number | null; theme: Theme };
  usage: Usage;
}
export interface Pack { id: string; listings: number; cents: number }
export interface Boot { me: Me; listings: Listing[]; packs: Pack[]; links: { coffee: string; contactEmail: string } }

export class ApiFailure extends Error {
  status: number;
  data: any;
  constructor(status: number, data: any) {
    super(data?.error || `Request failed (${status})`);
    this.status = status;
    this.data = data;
  }
}

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method || 'GET',
      headers: init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiFailure(0, { error: "You're offline. Check your connection and try again." });
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== 'undefined') window.location.href = '/';
  if (!res.ok) throw new ApiFailure(res.status, data);
  return data as T;
}

export function money(n: number | null | undefined, currency = 'USD') {
  if (n == null) return '';
  const symbol: Record<string, string> = { USD: '$', GBP: '£', EUR: '€', AUD: 'A$', CAD: 'C$' };
  const s = symbol[currency] ?? '$';
  return `${s}${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
