import { withUser, readJson } from '@/lib/server/route';
import { exportCsv } from '@/lib/server/service';

export const POST = withUser(async ({ user, deps, req }) => exportCsv(deps, user.id, (await readJson(req))?.ids));
