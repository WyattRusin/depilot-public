import { withUser, readJson } from '@/lib/server/route';
import { editListing, removeListing } from '@/lib/server/service';

type P = { id: string };
export const PATCH = withUser<P>(async ({ user, deps, req, params }) => editListing(deps, user.id, params.id, await readJson(req)));
export const DELETE = withUser<P>(async ({ user, deps, params }) => removeListing(deps, user.id, params.id));
