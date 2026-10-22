import { withUser } from '@/lib/server/route';
import { rewriteListing } from '@/lib/server/service';

export const maxDuration = 60;

type P = { id: string };
export const POST = withUser<P>(async ({ user, deps, params }) => rewriteListing(deps, user.id, params.id));
