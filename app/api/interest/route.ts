import { withUser } from '@/lib/server/route';
import { registerInterest } from '@/lib/server/service';

export const POST = withUser(async ({ user, deps }) => registerInterest(deps, user.id));
