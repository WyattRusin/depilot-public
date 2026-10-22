import { withUser, readJson } from '@/lib/server/route';
import { ApiError } from '@/lib/server/service';
import { createCheckout, packsEnabled } from '@/lib/server/billing';

export const POST = withUser(async ({ user, req }) => {
  if (!packsEnabled()) throw new ApiError(404, 'Not available');
  const body = await readJson(req);
  return { url: await createCheckout(user, String(body?.pack || '')) };
});
