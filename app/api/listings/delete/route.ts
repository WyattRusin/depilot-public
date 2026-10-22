import { withUser, readJson } from '@/lib/server/route';
import { removeListings } from '@/lib/server/service';

export const POST = withUser(async ({ user, deps, req }) => removeListings(deps, user.id, await readJson(req)));
