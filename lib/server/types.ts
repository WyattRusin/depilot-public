import type { DepopFields } from '../depop/fields.ts';
import type { Comp, Pricing } from '../pricing/types.ts';

export interface Profile {
  id: string; email: string | null; full_name: string | null; avatar_url: string | null;
  location: string; currency: string;
  domestic_shipping: number | null; intl_shipping: number | null;
  bonus_credits: number;
  theme?: 'light' | 'dark' | 'system';
}

export interface ListingRow {
  id: string; user_id: string; created_at: string; updated_at: string;
  status: 'analyzing' | 'pricing' | 'ready' | 'error';
  photo_paths: string[];
  ai: Record<string, any> | null;
  fields: DepopFields | null;
  description: string | null;
  price: number | null;
  pricing: (Partial<Pricing> & { pending?: boolean; imageComps?: Comp[]; runs?: number; userPriced?: boolean }) | null;
  exported_at: string | null;
  error: string | null;
  photos_deleted_at?: string | null;
  rewrites?: number;
}

export interface AdminSnapshot {
  profiles: { id: string; email: string | null; created_at: string }[];
  listings: {
    id: string; user_id: string; status: string; created_at: string; error: string | null; price: number | null;
    title: string | null; confidence: string | null; cost: number | null; sourceErrors: string[] | null;
    failure?: string | null;
  }[];
  spend: { user_id: string | null; kind: string; cents: number; created_at: string }[];
  interest: { user_id: string | null; created_at: string }[];
}

export interface ConsumeResult {
  ok: boolean; reason: '' | 'daily' | 'monthly';
  used_today: number; used_month: number; bonus_credits: number; paid: boolean;
}

export interface Repo {
  getProfile(userId: string): Promise<Profile | null>;
  updateProfile(userId: string, patch: Partial<Profile>): Promise<Profile>;
  usageCounts(userId: string): Promise<{ used_today: number; used_month: number }>;
  consumeListing(userId: string, daily: number, monthly: number, listingId: string): Promise<ConsumeResult>;
  refundAnalysis(userId: string, listingId: string): Promise<void>;
  monthSpendCents(): Promise<number>;
  logSpend(entry: { user_id: string | null; kind: string; cents: number }): Promise<void>;
  logEvent(userId: string, kind: string): Promise<void>;
  hasEvent(userId: string, kind: string): Promise<boolean>;
  adminSnapshot(since: string): Promise<AdminSnapshot>;
  addCredits(userId: string, sessionId: string, credits: number, amountCents: number): Promise<boolean>;
  takeSlot(userId: string, key: string, limit: number, windowSec: number): Promise<boolean>;
  releaseSlot(userId: string, key: string): Promise<void>;
  pruneRateLimits(): Promise<void>;
  orphanPhotos(limit: number): Promise<string[]>;

  insertListing(row: Pick<ListingRow, 'id' | 'user_id' | 'photo_paths' | 'status'>): Promise<ListingRow>;
  getListing(userId: string, id: string): Promise<ListingRow | null>;
  listListings(userId: string, limit: number): Promise<ListingRow[]>;
  updateListing(userId: string, id: string, patch: Partial<ListingRow>): Promise<ListingRow>;
  updateListingIf(userId: string, id: string, patch: Partial<ListingRow>, expectUpdatedAt: string): Promise<ListingRow | null>;
  deleteListing(userId: string, id: string): Promise<void>;
  markExported(userId: string, ids: string[]): Promise<void>;
  listForCleanup(exportedBefore: string, createdBefore: string, limit: number): Promise<ListingRow[]>;
  markPhotosDeleted(ids: string[]): Promise<void>;

  downloadPhoto(path: string): Promise<{ base64: string; mimeType: string }>;
  removePhotos(paths: string[]): Promise<void>;
  movePhoto(from: string, to: string): Promise<void>;
  publicUrl(path: string): string;
}
