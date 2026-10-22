import 'server-only';
import { supabaseAdmin } from '../supabase/server';
import { SUPABASE_URL } from '../env';
import type { Repo, Profile, ListingRow, ConsumeResult, AdminSnapshot } from './types';

const BUCKET = 'photos';

function check<T>(res: { data: T; error: any }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message || res.error}`);
  return res.data;
}

export function supabaseRepo(): Repo {
  const db = supabaseAdmin();
  return {
    async getProfile(userId) {
      const r = await db.from('profiles').select('*').eq('id', userId).maybeSingle();
      return check(r, 'load profile') as Profile | null;
    },
    async updateProfile(userId, patch) {
      const r = await db.from('profiles').upsert({ id: userId, ...patch }).select('*').single();
      return check(r, 'save settings') as Profile;
    },
    async usageCounts(userId) {
      const r = await db.rpc('usage_counts', { p_user: userId });
      const rows = check(r, 'usage') as { used_today: number; used_month: number }[];
      return rows[0] || { used_today: 0, used_month: 0 };
    },
    async consumeListing(userId, daily, monthly, listingId) {
      const r = await db.rpc('consume_listing', { p_user: userId, p_daily: daily, p_monthly: monthly, p_listing: listingId });
      const rows = check(r, 'quota') as ConsumeResult[];
      return rows[0];
    },
    async monthSpendCents() {
      const r = await db.rpc('month_spend_cents');
      return Number(check(r, 'spend')) || 0;
    },
    async logSpend(entry) {
      if (!(entry.cents > 0)) return;
      check(await db.from('spend_log').insert({ ...entry, cents: Math.round(entry.cents * 10000) / 10000 }), 'log spend');
    },
    async logEvent(userId, kind) {
      check(await db.from('spend_log').insert({ user_id: userId, kind, cents: 0 }), 'log event');
    },
    async hasEvent(userId, kind) {
      const r = await db.from('spend_log').select('id').eq('user_id', userId).eq('kind', kind).limit(1);
      return (check(r, 'event') as unknown[]).length > 0;
    },
    async adminSnapshot(since) {
      const [profiles, listings, spend, interest] = await Promise.all([
        db.from('profiles').select('id,email,created_at').order('created_at', { ascending: false }).limit(5000),
        db.from('listings')
          .select('id,user_id,status,created_at,error,price,title:ai->>title,confidence:pricing->>confidenceLabel,cost:pricing->debug->>totalCents,sourceErrors:pricing->errors,failure:pricing->debug->analysis->>failed')
          .gte('created_at', since).order('created_at', { ascending: false }).limit(5000),
        db.from('spend_log').select('user_id,kind,cents,created_at').gte('created_at', since).neq('kind', 'interest').limit(20000),
        db.from('spend_log').select('user_id,created_at').eq('kind', 'interest').order('created_at', { ascending: false }).limit(1000),
      ]);
      const ls = check(listings, 'admin listings') as any[];
      return {
        profiles: check(profiles, 'admin profiles') as AdminSnapshot['profiles'],
        listings: ls.map(l => ({ ...l, cost: l.cost == null ? null : Number(l.cost) })),
        spend: (check(spend, 'admin spend') as any[]).map(s => ({ ...s, cents: Number(s.cents) })),
        interest: check(interest, 'admin interest') as AdminSnapshot['interest'],
      };
    },
    async refundAnalysis(userId, listingId) {
      check(await db.rpc('refund_analysis', { p_user: userId, p_listing: listingId }), 'refund');
    },
    async addCredits(userId, sessionId, credits, amountCents) {
      const r = await db.rpc('add_credits', { p_user: userId, p_session: sessionId, p_credits: credits, p_amount: amountCents });
      return Boolean(check(r, 'add credits'));
    },
    async takeSlot(userId, key, limit, windowSec) {
      const r = await db.rpc('take_slot', { p_user: userId, p_key: key, p_limit: limit, p_window: windowSec });
      return Boolean(check(r, 'rate limit'));
    },
    async releaseSlot(userId, key) {
      check(await db.rpc('release_slot', { p_user: userId, p_key: key }), 'release rate limit');
    },
    async pruneRateLimits() {
      check(await db.rpc('prune_rate_limits'), 'prune rate limits');
    },
    async orphanPhotos(limit) {
      const rows = check(await db.rpc('orphan_photos', { p_limit: limit }), 'orphan photos') as { name: string }[];
      return (rows || []).map(r => r.name);
    },
    async insertListing(row) {
      return check(await db.from('listings').insert(row).select('*').single(), 'create listing') as ListingRow;
    },
    async getListing(userId, id) {
      return check(await db.from('listings').select('*').eq('id', id).eq('user_id', userId).maybeSingle(), 'load listing') as ListingRow | null;
    },
    async listListings(userId, limit) {
      return check(await db.from('listings').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit), 'list') as ListingRow[];
    },
    async updateListing(userId, id, patch) {
      const r = await db.from('listings').update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id).eq('user_id', userId).select('*').single();
      return check(r, 'save listing') as ListingRow;
    },
    async updateListingIf(userId, id, patch, expectUpdatedAt) {
      const r = await db.from('listings').update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id).eq('user_id', userId).eq('updated_at', expectUpdatedAt).select('*').maybeSingle();
      return check(r, 'save listing') as ListingRow | null;
    },
    async deleteListing(userId, id) {
      check(await db.from('listings').delete().eq('id', id).eq('user_id', userId), 'delete listing');
    },
    async markExported(userId, ids) {
      if (!ids.length) return;
      check(await db.from('listings').update({ exported_at: new Date().toISOString() }).in('id', ids).eq('user_id', userId), 'mark exported');
    },
    async listForCleanup(exportedBefore, createdBefore, limit) {
      const r = await db.from('listings').select('*').is('photos_deleted_at', null)
        .or(`exported_at.lt.${exportedBefore},created_at.lt.${createdBefore}`).limit(limit);
      return check(r, 'cleanup list') as ListingRow[];
    },
    async markPhotosDeleted(ids) {
      if (!ids.length) return;
      check(await db.from('listings').update({ photos_deleted_at: new Date().toISOString() }).in('id', ids), 'mark photos deleted');
    },
    async downloadPhoto(path) {
      const r = await db.storage.from(BUCKET).download(path);
      if (r.error || !r.data) throw new Error(`photo ${path}: ${r.error?.message || 'missing'}`);
      const buf = Buffer.from(await r.data.arrayBuffer());
      return { base64: buf.toString('base64'), mimeType: r.data.type || 'image/jpeg' };
    },
    async removePhotos(paths) {
      if (paths.length) await db.storage.from(BUCKET).remove(paths);
    },
    async movePhoto(from, to) {
      const r = await db.storage.from(BUCKET).move(from, to);
      if (r.error) throw new Error(`move ${from}: ${r.error.message}`);
    },
    publicUrl(path) {
      return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;
    },
  };
}
