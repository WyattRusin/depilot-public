import { withUser } from '@/lib/server/route';
import { bootstrap } from '@/lib/server/service';
import { packsEnabled, PACKS } from '@/lib/server/billing';
import { APP_LINKS } from '@/lib/app-config';

export const GET = withUser(async ({ user, deps }) => ({
  ...(await bootstrap(deps, user)),
  packs: packsEnabled() ? PACKS : [],
  links: APP_LINKS,
}));
