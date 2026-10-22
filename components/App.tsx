'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiFailure, downloadText, money, type Boot, type Listing, type Me, type Pack, type Usage } from '@/lib/client/api';
import { compressImage, makeThumb, newId } from '@/lib/client/image';
import { applyTheme } from '@/lib/client/theme';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { DEPOP_LOCATIONS, label } from '@/lib/depop/data';
import { allowedSizes } from '@/lib/depop/sizes';
import {
  MAX_PHOTOS, bucketOf, isExportable, isStuck, monthOf, photoPath, refillDay, titleOf, type Slot,
} from '@/lib/client/items';
import { Queue, canPick, tabItems, type Pending, type Tab } from './Queue';
import { Grid } from './Grid';
import { ItemView } from './ItemView';
import { SettingsContent, AskButton } from './Settings';
import { BrandSheet, ExportSheet, PickerSheet, SentSheet, plainOptions, type ExportResult } from './Sheets';
import { Sheet } from './Sheet';
import { NewItemSheet, type DraftPhoto } from './NewItemSheet';
import { Wordmark } from './Logo';
import { EmptyItem, GhostRows } from './Empty';
import { useDesktop } from './hooks';
import { Back, Download, Photos, Plus } from './icons';

const YEAR = '31536000';
interface Job extends Pending { shots: { file: File; slot: Slot }[]; uploaded?: string[] }
interface Toast { id: number; msg: string; error?: boolean }
type View = 'home' | 'item' | 'settings';

const isImage = (f: File) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name);
const ORDER: Slot[] = ['front', 'back', 'tag', 'measure'];
const slotsFor = (files: File[]) => files.slice(0, MAX_PHOTOS).map((file, i) => ({ file, slot: ORDER[i] || 'more' as Slot }));
const fromUrl = (): { view: View; id: string | null } => {
  if (typeof window === 'undefined') return { view: 'home', id: null };
  const q = new URLSearchParams(window.location.search);
  if (q.get('view') === 'settings') return { view: 'settings', id: null };
  const id = q.get('item');
  return id ? { view: 'item', id } : { view: 'home', id: null };
};

export function App() {
  const desktop = useDesktop();
  const [me, setMe] = useState<Me | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [bootFailed, setBootFailed] = useState(false);
  const [view, setView] = useState<View>('home');
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('list');
  const [selecting, setSelecting] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [delArmed, setDelArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [draft, setDraft] = useState<DraftPhoto[] | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sent, setSent] = useState<ExportResult | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shipPick, setShipPick] = useState(false);
  const [sizeFor, setSizeFor] = useState<Listing | null>(null);
  const [brandFor, setBrandFor] = useState<Listing | null>(null);
  const [pricing, setPricing] = useState<Set<string>>(new Set());
  const [priceFailed, setPriceFailed] = useState<Set<string>>(new Set());
  const [retrying, setRetrying] = useState<Set<string>>(new Set());
  const [rewriting, setRewriting] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [scrolled, setScrolled] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const pricingRef = useRef(new Set<string>());
  const dragDepth = useRef(0);

  const toast = useCallback((msg: string, error = false) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t.slice(-2), { id, msg, error }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), error ? 5000 : 2400);
  }, []);
  const setUsage = useCallback((usage?: Usage) => { if (usage) setMe(m => (m ? { ...m, usage } : m)); }, []);
  const upsert = useCallback((l: Listing) => setListings(ls => {
    const i = ls.findIndex(x => x.id === l.id);
    if (i === -1) return [l, ...ls];
    const next = ls.slice(); next[i] = l; return next;
  }), []);
  const flag = (set: React.Dispatch<React.SetStateAction<Set<string>>>, id: string, on: boolean) =>
    set(s => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });

  const go = useCallback((v: View, id: string | null = null) => {
    setView(v); setOpenId(id);
    const url = v === 'item' && id ? `?item=${id}` : v === 'settings' ? '?view=settings' : '/';
    if (v === 'home') window.history.replaceState(null, '', '/');
    else window.history.pushState({ v, id }, '', url);
    window.scrollTo(0, 0);
  }, []);
  const home = useCallback(() => {
    if (window.history.state?.v) window.history.back();
    else { setView('home'); setOpenId(null); window.history.replaceState(null, '', '/'); }
  }, []);
  const desktopRef = useRef(desktop);
  desktopRef.current = desktop;
  useEffect(() => {
    const onPop = () => {
      if (desktopRef.current) return;
      const s = fromUrl();
      setView(s.view); setOpenId(s.id);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const price = useCallback(async (id: string) => {
    if (pricingRef.current.has(id)) return;
    pricingRef.current.add(id);
    flag(setPricing, id, true); flag(setPriceFailed, id, false);
    try {
      const r = await api<{ listing: Listing }>(`/api/listings/${id}/price`, { method: 'POST' });
      upsert(r.listing);
    } catch (e) {
      if ((e as ApiFailure).data?.code !== 'busy' && (e as ApiFailure).status !== 404) {
        flag(setPriceFailed, id, true);
        toast((e as Error).message, true);
      }
    } finally {
      pricingRef.current.delete(id);
      flag(setPricing, id, false);
    }
  }, [toast, upsert]);

  useEffect(() => {
    (async () => {
      try {
        const b = await api<Boot>('/api/bootstrap');
        setMe(b.me);
        setPacks(b.packs || []);
        applyTheme(b.me.settings.theme || 'light');
        setListings(b.listings);
        b.listings.filter(x => x.status === 'pricing').forEach(x => price(x.id));
        const s = fromUrl();
        if (s.view === 'settings') setView('settings');
        else if (s.id && b.listings.some(l => l.id === s.id)) { setView('item'); setOpenId(s.id); }
      } catch (e) {
        if ((e as ApiFailure).status === 401 || (e as ApiFailure).status === 403) { window.location.href = '/'; return; }
        setBootFailed(true);
      } finally {
        setLoaded(true);
      }
    })();
    const onScroll = () => setScrolled(window.scrollY > 4);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [price, toast]);

  const watch = listings.some(l => (l.status === 'analyzing' && !isStuck(l)) || l.status === 'pricing');
  const repriced = useRef(new Set<string>());
  useEffect(() => {
    if (!loaded || !watch) return;
    const refresh = async () => {
      if (document.visibilityState !== 'visible') return;
      const r = await api<{ listings: Listing[] }>('/api/listings').catch(() => null);
      if (!r) return;
      setListings(ls => {
        const fresh = new Set(r.listings.map(n => n.id));
        const merged = r.listings
          .filter(n => !jobsRef.current.has(n.id))
          .map(n => {
            const o = ls.find(x => x.id === n.id);
            return o && o.status === n.status && n.status !== 'analyzing' && n.status !== 'pricing' ? o : n;
          });
        return [...ls.filter(o => !fresh.has(o.id) && Date.now() - Date.parse(o.createdAt) < 120_000), ...merged];
      });
      r.listings
        .filter(l => l.status === 'pricing' && !pricingRef.current.has(l.id) && !repriced.current.has(l.id))
        .forEach(l => { repriced.current.add(l.id); price(l.id); });
    };
    const timer = setInterval(refresh, 15_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, [loaded, watch, price]);

  const jobsRef = useRef(new Set<string>());
  jobsRef.current = new Set(jobs.map(j => j.id));

  const put = async (path: string, blob: Blob) => {
    const { error } = await supabaseBrowser().storage.from('photos').upload(path, blob, { contentType: 'image/jpeg', upsert: true, cacheControl: YEAR });
    if (error) {
      console.error('[upload]', error.message);
      throw new Error(/row-level security|policy/i.test(error.message)
        ? "You've uploaded a lot of photos today. Try again tomorrow."
        : "Couldn't upload your photos. Check your connection and try again.");
    }
  };
  const putPhoto = async (path: string, file: File) => {
    if (!navigator.onLine) throw new Error("You're offline. Check your connection and try again.");
    const full = await compressImage(file);
    await Promise.all([put(path, full), makeThumb(full).then(t => put(path.replace(/\.jpg$/, '_t.jpg'), t))]);
  };

  const run = useCallback(async (job: Job) => {
    if (!me) return;
    const update = (patch: Partial<Job>) => setJobs(js => js.map(x => (x.id === job.id ? { ...x, ...patch } : x)));
    try {
      let paths = job.uploaded;
      if (!paths) {
        update({ stage: 'uploading', error: undefined });
        paths = await Promise.all(job.shots.map(async (s, i) => {
          const path = photoPath(me.id, job.id, i, s.slot);
          await putPhoto(path, s.file);
          return path;
        }));
        update({ uploaded: paths });
      }
      update({ stage: 'reading', error: undefined });
      const r = await api<{ listing: Listing; usage: Usage }>('/api/listings', { method: 'POST', body: {
        id: job.id, photoPaths: paths, arrange: true,
      } });
      setUsage(r.usage);
      upsert(r.listing);
      setJobs(js => js.filter(x => x.id !== job.id));
      job.previews.forEach(u => URL.revokeObjectURL(u));
      if (r.listing.status === 'pricing') price(r.listing.id);
    } catch (e) {
      const f = e as ApiFailure;
      if (f.data?.usage) setUsage(f.data.usage);
      if (['monthly', 'paused'].includes(f.data?.code)) {
        job.previews.forEach(u => URL.revokeObjectURL(u));
        setJobs(js => js.filter(x => x.id !== job.id));
        if (f.data.code === 'paused') setMe(m => (m ? { ...m, usage: { ...m.usage, paused: true } } : m));
        toast(f.message, true);
        return;
      }
      if (f.data?.listing) {
        upsert(f.data.listing);
        job.previews.forEach(u => URL.revokeObjectURL(u));
        setJobs(js => js.filter(x => x.id !== job.id));
        return;
      }
      update({ stage: 'error', error: f.message || 'Something went wrong. Please try again.' });
    }
  }, [me, price, toast, upsert, setUsage]);

  const usage = me?.usage;
  const blocked = usage ? (usage.paused ? 'paused' : usage.left <= 0 ? 'monthly' : null) : null;

  const addItem = useCallback((shots: { file: File; slot: Slot }[]) => {
    if (!me || !shots.length || blocked) return;
    const job: Job = {
      id: newId(), stage: 'uploading',
      shots,
      previews: shots.map(s => URL.createObjectURL(s.file)),
    };
    setJobs(js => [job, ...js]);
    run(job);
  }, [me, blocked, run]);
  const addFiles = useCallback((list: FileList | File[] | null) => {
    const files = Array.from(list || []).filter(isImage);
    if (!files.length) return;
    if (files.length > MAX_PHOTOS) toast(`Using the first ${MAX_PHOTOS} photos.`);
    addItem(slotsFor(files));
    if (!desktop) go('home');
  }, [addItem, toast, desktop, go]);

  const pickOnPhone = useCallback((list: FileList | null) => {
    const files = Array.from(list || []).filter(isImage);
    if (files.length === 1) setDraft([{ file: files[0], url: URL.createObjectURL(files[0]) }]);
    else addFiles(files);
  }, [addFiles]);
  const addToDraft = (list: FileList | null) => {
    const have = draft || [];
    const files = Array.from(list || []).filter(isImage);
    const room = MAX_PHOTOS - have.length;
    if (files.length > room) toast(`Up to ${MAX_PHOTOS} photos per item.`);
    setDraft([...have, ...files.slice(0, Math.max(0, room)).map(file => ({ file, url: URL.createObjectURL(file) }))]);
  };
  const removeFromDraft = (url: string) => {
    URL.revokeObjectURL(url);
    setDraft(d => (d ? d.filter(x => x.url !== url) : d));
  };
  const closeDraft = () => { draft?.forEach(x => URL.revokeObjectURL(x.url)); setDraft(null); };
  const createFromDraft = () => {
    if (!draft?.length) return;
    addItem(slotsFor(draft.map(x => x.file)));
    closeDraft();
  };

  useEffect(() => {
    if (!desktop) return;
    const enter = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { dragDepth.current++; setDragOver(true); } };
    const leave = () => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragOver(false); };
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); };
    const drop = (e: DragEvent) => { e.preventDefault(); dragDepth.current = 0; setDragOver(false); if (!blocked) addFiles(e.dataTransfer?.files || null); };
    window.addEventListener('dragenter', enter); window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over); window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter); window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over); window.removeEventListener('drop', drop);
    };
  }, [desktop, addFiles, blocked]);

  const saves = useRef(new Map<string, number>());
  const patch = useCallback(async (id: string, body: Record<string, unknown>) => {
    if ('price' in body && typeof body.price === 'number') {
      setListings(ls => ls.map(l => (l.id === id ? { ...l, price: body.price as number } : l)));
    }
    const n = (saves.current.get(id) || 0) + 1;
    saves.current.set(id, n);
    try {
      const r = await api<{ listing: Listing }>(`/api/listings/${id}`, { method: 'PATCH', body });
      if (saves.current.get(id) === n) upsert(r.listing);
    } catch (e) {
      if ((e as ApiFailure).status === 404) return;
      toast((e as Error).message, true);
      const r = await api<{ listings: Listing[] }>('/api/listings').catch(() => null);
      if (r) setListings(r.listings);
    }
  }, [toast, upsert]);

  const retry = useCallback(async (id: string) => {
    flag(setRetrying, id, true);
    try {
      const r = await api<{ listing: Listing; usage: Usage }>(`/api/listings/${id}/retry`, { method: 'POST' });
      upsert(r.listing); setUsage(r.usage);
      if (r.listing.status === 'pricing') price(id);
    } catch (e) {
      const f = e as ApiFailure;
      if (f.data?.listing) upsert(f.data.listing);
      if (f.data?.usage) setUsage(f.data.usage);
      if (f.data?.code === 'monthly') setListings(ls => ls.filter(l => l.id !== id));
      toast(f.message, true);
    } finally {
      flag(setRetrying, id, false);
    }
  }, [price, toast, upsert, setUsage]);

  const rewrite = useCallback(async (id: string) => {
    flag(setRewriting, id, true);
    try {
      const r = await api<{ listing: Listing }>(`/api/listings/${id}/rewrite`, { method: 'POST' });
      upsert(r.listing);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      flag(setRewriting, id, false);
    }
  }, [toast, upsert]);

  const removing = useRef(new Set<string>());
  const remove = useCallback(async (id: string) => {
    if (removing.current.has(id)) return;
    removing.current.add(id);
    try {
      await api(`/api/listings/${id}`, { method: 'DELETE' });
      setListings(ls => ls.filter(l => l.id !== id));
      if (openId === id) { if (desktop) setOpenId(null); else home(); }
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      removing.current.delete(id);
    }
  }, [toast, openId, desktop, home]);

  const photo = useCallback(async (l: Listing, file: File, slot: Slot, replace?: string) => {
    if (!me) return;
    const index = replace ? Math.max(0, l.photos.findIndex(u => u.includes(replace))) : l.photos.length;
    const path = photoPath(me.id, l.id, index, slot, true);
    const key = replace || `${l.id}:${slot}`;
    flag(setUploading, key, true);
    try {
      await putPhoto(path, file);
      const r = await api<{ listing: Listing }>(`/api/listings/${l.id}/photos`, { method: 'POST', body: { add: path, ...(replace ? { remove: replace } : {}) } });
      upsert(r.listing);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      flag(setUploading, key, false);
    }
  }, [me, toast, upsert]);

  const makeCover = useCallback(async (l: Listing, path: string) => {
    try {
      const r = await api<{ listing: Listing }>(`/api/listings/${l.id}/photos`, { method: 'POST', body: { cover: path } });
      upsert(r.listing);
    } catch (e) {
      toast((e as Error).message, true);
    }
  }, [toast, upsert]);

  const removePhoto = useCallback(async (l: Listing, path: string) => {
    try {
      const r = await api<{ listing: Listing }>(`/api/listings/${l.id}/photos`, { method: 'POST', body: { remove: path } });
      upsert(r.listing);
    } catch (e) {
      toast((e as Error).message, true);
    }
  }, [toast, upsert]);

  const copy = useCallback(async (text: string) => {
    let ok = true;
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      ok = document.execCommand('copy'); ta.remove();
    }
    toast(ok ? 'Copied' : 'Couldn’t copy. Select the text and copy it yourself.', !ok);
  }, [toast]);

  const exportable = useMemo(() => listings.filter(isExportable), [listings]);
  const doExport = async (ids: string[]): Promise<boolean> => {
    setExporting(true);
    try {
      const r = await api<Omit<ExportResult, 'files'> & { files: { filename: string; csv: string }[] }>('/api/export', { method: 'POST', body: { ids } });
      if (r.files[0]) downloadText(r.files[0].filename, r.files[0].csv);
      const now = new Date().toISOString();
      setListings(ls => ls.map(l => (r.included.includes(l.id) ? { ...l, exportedAt: now } : l)));
      setExportOpen(false);
      setSent({ files: r.files, included: r.included, rejected: r.rejected });
      return true;
    } catch (e) {
      toast((e as Error).message, true);
      return false;
    } finally {
      setExporting(false);
    }
  };

  const flat = useMemo(() => {
    const by = (b: string) => listings.filter(l => bucketOf(l) === b);
    return [...by('working'), ...by('needs'), ...by('ready'), ...by('sent')];
  }, [listings]);
  const reviewable = flat.filter(l => bucketOf(l) === 'needs' || bucketOf(l) === 'ready');
  const nextAfter = (id: string) => {
    const i = reviewable.findIndex(l => l.id === id);
    return i === -1 ? reviewable[0] || null : reviewable[i + 1] || null;
  };

  useEffect(() => {
    if (desktop && openId && loaded && !listings.some(l => l.id === openId)) setOpenId(null);
  }, [desktop, loaded, openId, listings]);

  useEffect(() => {
    if (!desktop) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [role="dialog"], [role="slider"]')) return;
      if (e.key === 'Escape') {
        if (selecting) { e.preventDefault(); endSelect(); } else if (openId) { e.preventDefault(); setOpenId(null); }
        return;
      }
      if (!openId || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
      const walk = tabItems(listings, tab);
      const i = walk.findIndex(l => l.id === openId);
      const n = walk[e.key === 'ArrowDown' ? i + 1 : i - 1];
      if (!n) return;
      e.preventDefault();
      if (t.closest('.row')) t.blur();
      setOpenId(n.id);
      requestAnimationFrame(() => document.querySelector('.desk-left .row.is-on')?.scrollIntoView({ block: 'nearest' }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [desktop, listings, tab, openId, selecting, endSelect]);

  const discardJob = (id: string) => {
    const j = jobs.find(x => x.id === id);
    j?.previews.forEach(u => URL.revokeObjectURL(u));
    setJobs(js => js.filter(x => x.id !== id));
  };

  const listCount = tabItems(listings, 'list').length + jobs.length;
  const sentCount = tabItems(listings, 'sent').length;
  const openItem = useCallback((id: string) => {
    const l = listings.find(x => x.id === id);
    if (l) setTab(bucketOf(l) === 'sent' ? 'sent' : 'list');
    if (desktop) setOpenId(id); else go('item', id);
  }, [listings, desktop, go]);
  const showTab = (t: Tab) => { setTab(t); setChosen(new Set()); setDelArmed(false); };
  function endSelect() { setSelecting(false); setChosen(new Set()); setDelArmed(false); }
  const pickable = tabItems(listings, tab).filter(canPick);
  const allChosen = pickable.length > 0 && pickable.every(l => chosen.has(l.id));
  const toggle = (id: string) => { setDelArmed(false); setChosen(c => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const toggleAll = () => { setDelArmed(false); setChosen(allChosen ? new Set() : new Set(pickable.map(l => l.id))); };
  const removeMany = async () => {
    const ids = [...chosen];
    if (!ids.length) return;
    setDeleting(true);
    try {
      const r = await api<{ deleted: string[]; skipped: string[] }>('/api/listings/delete', { method: 'POST', body: { ids } });
      const gone = new Set(r.deleted);
      setListings(ls => ls.filter(l => !gone.has(l.id)));
      toast(r.skipped.length
        ? `Deleted ${r.deleted.length}. ${r.skipped.length} still being read, so kept.`
        : `Deleted ${r.deleted.length} item${r.deleted.length === 1 ? '' : 's'}`);
      endSelect();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setDeleting(false);
    }
  };
  const tabs = (
    <div className="tabs" role="tablist" aria-label="Items">
      <button type="button" role="tab" aria-selected={tab === 'list'} onClick={() => showTab('list')}>To list<span>{listCount}</span></button>
      <button type="button" role="tab" aria-selected={tab === 'sent'} onClick={() => showTab('sent')}>Sent<span>{sentCount}</span></button>
    </div>
  );
  const selectToggle = listings.length > 0 && (
    <button type="button" className="chip" onClick={() => (selecting ? endSelect() : setSelecting(true))}>{selecting ? 'Cancel' : 'Select'}</button>
  );
  const selectBar = (
    <div className="selbar" role="toolbar" aria-label="Selected items">
      <button type="button" className="chip" onClick={toggleAll} disabled={!pickable.length}>{allChosen ? 'Clear' : 'Select all'}</button>
      <span className="selbar-n">{chosen.size} selected</span>
      {desktop && <button type="button" className="chip is-quiet" onClick={endSelect}>Cancel</button>}
      {tab === 'sent' && (
        <button type="button" className="btn btn-ghost btn-csv" disabled={!chosen.size || exporting}
          onClick={async () => { if (await doExport([...chosen])) endSelect(); }}>
          {exporting ? <span className="spin" /> : <><Download />Download CSV</>}
        </button>
      )}
      <button type="button" className={`btn btn-del${delArmed ? ' is-armed' : ''}`} disabled={!chosen.size || deleting}
        onClick={() => (delArmed ? removeMany() : setDelArmed(true))}>
        {deleting ? <span className="spin" /> : delArmed ? `Delete ${chosen.size} for good` : `Delete${chosen.size ? ` ${chosen.size}` : ''}`}
      </button>
    </div>
  );
  const tabEmpty = tab === 'sent'
    ? <p className="tab-empty">Nothing sent to Depop yet.</p>
    : <p className="tab-empty">Nothing waiting. {sentCount} sent to Depop.</p>;
  const tabHasItems = tab === 'sent' ? sentCount > 0 : listCount > 0;

  const currency = me?.settings.currency || 'USD';
  const initial = (me?.name || me?.email || '?').trim().charAt(0).toUpperCase();
  const left = usage ? Math.max(0, usage.left) : 0;
  const quota = usage && !usage.admin && (
    <button type="button" className={`quota link${left <= 5 ? ' is-low' : ''}`} style={{ textDecoration: 'none', fontWeight: left <= 5 ? 600 : 400 }}
      onClick={() => (desktop ? setSettingsOpen(true) : go('settings'))}>
      {left} item{left === 1 ? '' : 's'} left
    </button>
  );
  const avatar = (
    <button type="button" className="avatar" onClick={() => (desktop ? setSettingsOpen(true) : go('settings'))} aria-label="Settings" disabled={!me}>
      {me?.avatar ? <img src={me.avatar} alt="" referrerPolicy="no-referrer" /> : me ? initial : ''}
    </button>
  );
  const limitCard = blocked && usage && (
    <div className="limit" role="status" style={desktop ? { position: 'static', margin: '16px 24px 0', boxShadow: 'inset 0 0 0 1px var(--line)' } : undefined}>
      <b>{blocked === 'monthly' ? `That's all ${usage.monthlyLimit} for ${monthOf(usage.monthResets)}` : `Depilot is full for ${monthOf(usage.monthResets)}`}</b>
      <p>New items again on {refillDay(usage.monthResets)}. Everything here still edits and exports.</p>
      {blocked === 'monthly' && <AskButton usage={usage} onUsage={setUsage} toast={toast} />}
    </div>
  );
  const handlers = (l: Listing) => ({
    onPatch: (b: Record<string, unknown>) => patch(l.id, b),
    onPhoto: (file: File, slot: Slot, replace?: string) => photo(l, file, slot, replace),
    onRemovePhoto: (path: string) => removePhoto(l, path),
    onCover: (path: string) => makeCover(l, path),
    onRecheck: () => price(l.id),
    onRewrite: () => rewrite(l.id),
    onDelete: () => remove(l.id),
    onRetry: () => retry(l.id),
    onRetryPrice: () => price(l.id),
    onCopy: copy,
    onShipping: () => setShipPick(true),
  });
  const queue = (
    <Queue listings={listings} pending={jobs} currency={currency} pricing={pricing} priceFailed={priceFailed} retrying={retrying}
      tab={tab} selectedId={desktop ? openId : null}
      selecting={selecting && !openId} chosen={chosen} onToggle={toggle}
      onOpen={openItem}
      onPatch={patch} onRetry={retry} onRetryPrice={price} onDelete={remove}
      onPendingRetry={id => { const j = jobs.find(x => x.id === id); if (j) run(j); }}
      onPendingDiscard={discardJob}
      onMoreSizes={setSizeFor} onMoreBrands={setBrandFor} />
  );
  const empty = loaded && !listings.length && !jobs.length;

  const overlays = (
    <>
      {draft && me && (
        <NewItemSheet photos={draft} onAdd={addToDraft} onRemove={removeFromDraft} onCreate={createFromDraft} onClose={closeDraft} />
      )}
      {exportOpen && me && (
        <ExportSheet items={exportable} location={me.settings.location} currency={currency} busy={exporting}
          onChangeLocation={() => setShipPick(true)} onExport={doExport} onClose={() => setExportOpen(false)} />
      )}
      {sent && <SentSheet result={sent} listings={listings} onClose={() => setSent(null)} />}
      {shipPick && me && (
        <PickerSheet title="Ships from" options={plainOptions(DEPOP_LOCATIONS)} value={me.settings.location} search
          onPick={async v => {
            try { const next = await api<Me>('/api/settings', { method: 'PATCH', body: { location: v } }); setMe(m => (m ? { ...m, ...next, usage: next.usage || m.usage } : m)); }
            catch (e) { toast((e as Error).message, true); }
          }} onClose={() => setShipPick(false)} />
      )}
      {sizeFor?.fields && (
        <PickerSheet title="Size" options={plainOptions(allowedSizes(sizeFor.fields.category))} value={sizeFor.fields.size} none="No size"
          onPick={v => patch(sizeFor.id, { size: v })} onClose={() => setSizeFor(null)} />
      )}
      {brandFor?.fields && <BrandSheet value={brandFor.fields.brand} onPick={v => patch(brandFor.id, { brand: v })} onClose={() => setBrandFor(null)} />}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map(t => <div key={t.id} className={`toast${t.error ? ' is-error' : ''}`}>{t.msg}</div>)}
      </div>
    </>
  );

  if (bootFailed && !me) {
    return (
      <div className="app">
        <header className="top"><Wordmark /></header>
        <main className="bootfail">
          <h1 className="h1">Couldn&apos;t load your items</h1>
          <p>Check your connection, then try again.</p>
          <button type="button" className="btn btn-pri" onClick={() => window.location.reload()}>Try again</button>
        </main>
      </div>
    );
  }

  if (desktop) {
    const sel = listings.find(l => l.id === openId) || null;
    const listed = tabItems(listings, tab);
    const worth = listed.reduce((sum, l) => sum + (l.price || 0), 0);
    const needCount = listed.filter(l => bucketOf(l) === 'needs').length;
    const readyCount = listed.filter(l => bucketOf(l) === 'ready').length;
    const summary = tab === 'sent'
      ? [`${sentCount} sent to Depop`, worth ? `${money(worth, currency)} listed` : ''].filter(Boolean).join(' · ')
      : [needCount ? `${needCount} need${needCount === 1 ? 's' : ''} you` : '', readyCount ? `${readyCount} ready to export` : '', worth ? `${money(worth, currency)} if they all sell` : ''].filter(Boolean).join(' · ');
    const goHome = () => { setOpenId(null); };
    return (
      <div className="desk">
        <div className="desk-bar">
          <Wordmark onHome={goHome} />
          {quota}
          <label className={`btn btn-pri${blocked || !me ? ' btn-off' : ''}`} aria-disabled={Boolean(blocked) || !me} style={{ cursor: blocked ? 'default' : 'pointer' }}>
            <Plus />{blocked && usage ? `New item · ${refillDay(usage.monthResets)}` : 'New item'}
            <input type="file" accept="image/*" multiple className="vh" disabled={Boolean(blocked) || !me} onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
          </label>
          <button type="button" className="btn btn-ghost" onClick={() => setExportOpen(true)} disabled={!exportable.length}>Export {exportable.length || ''}</button>
          {avatar}
        </div>

        {sel ? (
          <div className="desk-main">
            <div className="desk-left">
              <div className="desk-lhead">
                <button type="button" className="back" onClick={goHome}><Back />All items</button>
                {tabs}
              </div>
              {queue}
            </div>
            <div className="desk-right">
              <ItemView key={sel.id} listing={sel} currency={currency} variant="pane" busy={pricing.has(sel.id)} priceFailed={priceFailed.has(sel.id)}
                rewriting={rewriting.has(sel.id)} retrying={retrying.has(sel.id)} uploading={uploading} {...handlers(sel)} />
            </div>
          </div>
        ) : (
          <main className="dhome" aria-busy={!loaded}>
            {limitCard}
            {empty ? (
              <div className="dhome-empty">
                <div style={{ width: 'min(520px, 100%)' }}>
                  <EmptyItem onFiles={addFiles} disabled={Boolean(blocked) || !me} />
                  {!blocked && (
                    <label className="btn btn-pri" style={{ marginTop: 24, cursor: 'pointer' }}>
                      <Photos />Choose photos of one item
                      <input type="file" accept="image/*" multiple className="vh" onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
                    </label>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="dhome-head">
                  <h1>Items</h1>
                  {tabs}
                  <span className="dhome-sum">{loaded ? summary : ''}</span>
                  {selectToggle}
                </div>
                {!loaded ? (
                  <ul className="grid">{[0, 1, 2, 3].map(i => <li key={i}><div className="card is-pending"><span className="card-photo" /><span className="card-body"><span className="skel" style={{ width: '80%' }} /></span></div></li>)}</ul>
                ) : tabHasItems ? (
                  <Grid listings={listings} pending={jobs} currency={currency} tab={tab} pricing={pricing} priceFailed={priceFailed} retrying={retrying}
                    selecting={selecting} chosen={chosen} onToggle={toggle} onOpen={openItem}
                    onPendingRetry={id => { const j = jobs.find(x => x.id === id); if (j) run(j); }} onPendingDiscard={discardJob} onRetry={retry} />
                ) : tabEmpty}
              </>
            )}
          </main>
        )}
        {selecting && !sel && selectBar}
        {dragOver && !blocked && <div className="drop-overlay">Drop photos of one item</div>}
        {settingsOpen && me && (
          <Sheet title="Settings" onClose={() => setSettingsOpen(false)}>
            <div style={{ margin: '0 calc(-1 * var(--pad))' }}><SettingsContent me={me} packs={packs} onSaved={setMe} toast={toast} /></div>
          </Sheet>
        )}
        {overlays}
      </div>
    );
  }

  if (view === 'settings' && me) {
    return (
      <div className="app">
        <div className={`itop${scrolled ? ' is-scrolled' : ''}`}>
          <button type="button" className="back" onClick={home}><Back />Items</button>
        </div>
        <h1 className="h1">Settings</h1>
        <SettingsContent me={me} packs={packs} onSaved={setMe} toast={toast} />
        {overlays}
      </div>
    );
  }

  const open = view === 'item' && openId ? listings.find(l => l.id === openId) || null : null;
  if (open) {
    const next = nextAfter(open.id);
    return (
      <div className="app">
        <ItemView key={open.id} listing={open} currency={currency} variant="page" busy={pricing.has(open.id)} priceFailed={priceFailed.has(open.id)}
          rewriting={rewriting.has(open.id)} retrying={retrying.has(open.id)} uploading={uploading}
          onBack={home} next={next && next.id !== open.id ? next : null}
          onNext={() => { if (next) { setOpenId(next.id); window.history.replaceState({ v: 'item', id: next.id }, '', `?item=${next.id}`); window.scrollTo(0, 0); } }}
          {...handlers(open)} />
        {overlays}
      </div>
    );
  }

  return (
    <div className="app">
      <header className={`top${scrolled ? ' is-scrolled' : ''}`}>
        <Wordmark />
        <div className="top-right">{quota}{avatar}</div>
      </header>
      <main className="page" aria-busy={!loaded}>
        <div className="home-head"><h1 className="h1">Items</h1>{selectToggle}</div>
        {!empty && loaded && tabs}
        {!loaded && (
          <ul className="list" style={{ marginTop: 14 }}>
            {[0, 1, 2].map(i => <li key={i}><div className="row"><span className="thumb" /><span className="r-main"><span className="skel" style={{ width: '70%' }} /><span className="skel" style={{ width: '40%' }} /></span></div></li>)}
          </ul>
        )}
        {empty ? <><EmptyItem onFiles={pickOnPhone} disabled={Boolean(blocked) || !me} /><GhostRows n={4} /></> : !loaded || tabHasItems ? queue : tabEmpty}
      </main>
      {limitCard}
      {selecting ? <div className="dock is-select">{selectBar}</div> : <div className="dock">
        {blocked && usage ? (
          <button type="button" className="btn btn-off" disabled>New item · {refillDay(usage.monthResets)}</button>
        ) : (
          <label className={`btn btn-pri${!me ? ' btn-off' : ''}`} aria-disabled={!me} style={{ cursor: me ? 'pointer' : 'default' }} aria-label="New item: choose photos of one item">
            <Photos />New item
            <input type="file" accept="image/*" multiple className="vh" disabled={!me} onChange={e => { pickOnPhone(e.target.files); e.target.value = ''; }} />
          </label>
        )}
        {!empty && exportable.length > 0 && (
          <button type="button" className="btn btn-ghost" onClick={() => setExportOpen(true)}>Export {exportable.length}</button>
        )}
      </div>}
      {overlays}
    </div>
  );
}
