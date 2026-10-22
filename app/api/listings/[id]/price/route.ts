import { withUser } from '@/lib/server/route';
import { priceListing } from '@/lib/server/service';

export const maxDuration = 120;

type P = { id: string };
export const POST = withUser<P>(async ({ user, deps, params }) => priceListing(deps, user.id, params.id));
