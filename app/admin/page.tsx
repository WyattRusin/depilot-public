import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { currentUser } from '@/lib/supabase/server';
import { buildDeps } from '@/lib/server/route';
import { adminStats } from '@/lib/server/service';
import { AdminView } from '@/components/AdminView';
import { APP_NAME } from '@/lib/app-config';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: `Admin · ${APP_NAME}`, robots: { index: false } };

export default async function AdminPage() {
  const user = await currentUser().catch(() => null);
  const deps = buildDeps(user);
  if (!deps.admin) notFound();
  return <AdminView s={await adminStats(deps)} />;
}
