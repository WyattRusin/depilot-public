import { withUser, readJson } from '@/lib/server/route';
import { createListing, listListings } from '@/lib/server/service';

export const maxDuration = 150;

export const GET = withUser(async ({ user, deps }) => listListings(deps, user.id));
export const POST = withUser(async ({ user, deps, req }) => createListing(deps, user.id, await readJson(req)));
