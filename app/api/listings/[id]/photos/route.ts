import { withUser, readJson } from '@/lib/server/route';
import { editPhotos } from '@/lib/server/service';

type P = { id: string };
export const POST = withUser<P>(async ({ user, deps, req, params }) => editPhotos(deps, user.id, params.id, await readJson(req)));
