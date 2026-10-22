import Link from 'next/link';
import type { AdminStats } from '@/lib/server/service';
import { Wordmark } from './Logo';

const c = (n: number | null | undefined) => (n == null ? '–' : `${n < 1 ? n.toFixed(2) : n.toFixed(1)}¢`);
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';

export function AdminView({ s }: { s: AdminStats }) {
  const pct = s.budgetCents ? Math.min(100, (s.spentCents / s.budgetCents) * 100) : 0;
  const month = new Date(s.month).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <div className="app">
      <header className="top">
        <Wordmark />
        <Link className="btn btn-ghost btn-sm" href="/">Back to app</Link>
      </header>
      <div className="admin">

      <h1 className="admin-h1">Admin <span>{month}</span></h1>

      <section className="admin-grid">
        <div className="stat">
          <span>Spent this month</span>
          <strong>{usd(s.spentCents)}</strong>
          <div className="track"><i style={{ width: `${pct}%`, background: pct >= 80 ? 'var(--bad)' : undefined }} /></div>
          <small>of {usd(s.budgetCents)} budget · {Object.entries(s.spendByKind).map(([k, v]) => `${k} ${usd(v)}`).join(' · ') || 'nothing yet'}</small>
        </div>
        <div className="stat"><span>Listings this month</span><strong>{s.listings.thisMonth}</strong>
          <small>{s.listings.failed} failed · avg cost {c(s.listings.avgCostCents)}</small></div>
        <div className="stat"><span>Users</span><strong>{s.users.total}</strong>
          <small>{s.users.newThisMonth} new · {s.users.activeThisMonth} active this month</small></div>
        <div className="stat"><span>Want a higher limit</span><strong>{s.interest.length}</strong>
          <small>tapped &ldquo;Ask for more&rdquo; (all time)</small></div>
        <div className="stat"><span>Price confidence</span><strong>{s.listings.confidence.High} / {s.listings.confidence.Medium} / {s.listings.confidence.Low}</strong>
          <small>high / medium / low, finished listings this month</small></div>
      </section>

      <section className="admin-sec">
        <h2>Busiest users this month</h2>
        {s.topUsers.length ? (
          <table className="admin-table"><thead><tr><th>User</th><th>Listings</th><th>Cost</th><th>Wants more</th></tr></thead>
            <tbody>{s.topUsers.map(u => (
              <tr key={u.email}><td>{u.email}</td><td>{u.listings}</td><td>{usd(u.cents)}</td><td>{u.wantsMore ? 'Yes' : ''}</td></tr>
            ))}</tbody></table>
        ) : <p className="note">No listings yet this month.</p>}
      </section>

      <section className="admin-sec">
        <h2>Asked for a higher limit</h2>
        {s.interest.length ? (
          <table className="admin-table"><thead><tr><th>User</th><th>When</th></tr></thead>
            <tbody>{s.interest.map((i, n) => <tr key={n}><td>{i.email}</td><td>{when(i.at)}</td></tr>)}</tbody></table>
        ) : <p className="note">Nobody yet. Emails to support@ about limits will show up in your inbox, not here.</p>}
      </section>

      <section className="admin-sec">
        <h2>Problems this month</h2>
        {s.recentErrors.length ? (
          <table className="admin-table"><thead><tr><th>When</th><th>User</th><th>Item</th><th>What happened</th></tr></thead>
            <tbody>{s.recentErrors.map((e, n) => (
              <tr key={n} className={e.failed ? 'is-bad' : ''}><td>{when(e.at)}</td><td>{e.email}</td><td>{e.title}</td><td className="wrap">{e.failed ? 'Failed: ' : 'Price source: '}{e.error}</td></tr>
            ))}</tbody></table>
        ) : <p className="note">No failures or price-source errors this month.</p>}
      </section>

      <section className="admin-sec">
        <h2>Latest listings</h2>
        {s.recent.length ? (
          <table className="admin-table"><thead><tr><th>When</th><th>User</th><th>Item</th><th>Price</th><th>Confidence</th><th>Cost</th></tr></thead>
            <tbody>{s.recent.map((l, n) => (
              <tr key={n}><td>{when(l.at)}</td><td>{l.email}</td><td>{l.title}</td><td>{l.price != null ? `$${l.price}` : l.status}</td><td>{l.confidence || '–'}</td><td>{c(l.cents)}</td></tr>
            ))}</tbody></table>
        ) : <p className="note">No listings yet this month.</p>}
      </section>

      <p className="note">Costs are the app&apos;s own estimates from published prices. Your real bills are in Google Cloud Billing and OpenWeb Ninja.</p>
      </div>
    </div>
  );
}
