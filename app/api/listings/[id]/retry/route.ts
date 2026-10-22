import { withUser } from '@/lib/server/route';
import { retryListing } from '@/lib/server/service';

export const maxDuration = 150;

type P = { id: string };
export const POST = withUser<P>(async ({ user, deps, params }) => retryListing(deps, user.id, params.id));
