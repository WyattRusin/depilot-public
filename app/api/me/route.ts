import { withUser } from '@/lib/server/route';
import { getMe } from '@/lib/server/service';

export const GET = withUser(async ({ user, deps }) => getMe(deps, user));
