import { withUser, readJson } from '@/lib/server/route';
import { saveSettings } from '@/lib/server/service';

export const PATCH = withUser(async ({ user, deps, req }) => saveSettings(deps, user.id, await readJson(req)));
