# Setup guide

This takes about **75 minutes**, mostly waiting on sign-up pages. Do the steps in order: later steps need values from earlier ones.

Keep a note open as you go. You'll collect these values:

| Name | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Step 1 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Step 1 |
| `SUPABASE_SECRET_KEY` | Step 1 |
| `GEMINI_API_KEY` | Step 2 |
| `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` | Step 3 |
| `OPENWEBNINJA_API_KEY` | Step 4 |
| `NEXT_PUBLIC_SITE_URL` | Step 6 (your Vercel address, later your domain) |
| `CRON_SECRET` | Step 6 (you make it up) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Step 9 (optional, off for now) |
| `NEXT_PUBLIC_COFFEE_URL` | Optional: a tip-jar link for the footer |

**Keep the secret values private.** Only the two `NEXT_PUBLIC_` values are safe to be seen; everything else is a password.

---

## 1. Supabase: database, login and photo storage (10 min)

1. Go to **supabase.com**, then sign up, then **New project**. Choose a strong database password and the region **West US (Oregon)**, `us-west-2`. The app's servers run in the same place (`vercel.json`), which keeps it fast. Wait about 2 minutes for it to finish.
2. Open **SQL Editor**, then **New query**. Paste the entire contents of `supabase/schema.sql` and click **Run**. You should see "Success. No rows returned". Then do the same with each file in `supabase/migrations/`, in order: `002_depilot.sql`, `003_theme.sql`, `004_launch_hardening.sql`.
3. **Project URL** goes into `NEXT_PUBLIC_SUPABASE_URL`. It looks like `https://abcdxyz.supabase.co`. It isn't on the API Keys page. The quickest way to get it is from your browser's address bar: the dashboard link is `supabase.com/dashboard/project/abcdxyz/...`, and the part after `/project/` is your project ID. Your URL is `https://` + that ID + `.supabase.co`. You can also find it under **Project Settings**, then **Data API**, or by clicking **Connect** at the top of the project.
4. Open **Project Settings**, then **API Keys**, and copy:
   - the **Publishable key** (`sb_publishable_...`) into `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - the **Secret key** (`sb_secret_...`; click to reveal) into `SUPABASE_SECRET_KEY`

   If your project only shows "anon" and "service_role" keys, use those instead. They work the same.

## 2. Gemini: the AI (5 min)

1. Go to **aistudio.google.com/apikey**, then **Create API key**, and copy it into `GEMINI_API_KEY`.
2. **Turn on billing for that key's Google Cloud project.** Click **Set up billing** next to the key. On the free tier, Google may use the data you send to improve its products, and the rate limits are low. Paid use costs about 2–3¢ per item.
3. **Set a budget alert.** In Google Cloud, go to **Billing**, then **Budgets & alerts**, and create a budget of $75 a month with email alerts at 50%, 90% and 100%. The app also stops taking new uploads by itself once its own estimate reaches `MONTHLY_BUDGET_USD`, but the alert is your second line of defence.

## 3. eBay: live listings and image search (5 min)

1. Go to **developer.ebay.com**, then **My Account**, then **Application Keys**.
2. Use the **Production** keyset, not Sandbox:
   - **App ID (Client ID)** goes into `EBAY_CLIENT_ID`
   - **Cert ID (Client Secret)** goes into `EBAY_CLIENT_SECRET`
3. If the production keyset is disabled, eBay is asking about **Marketplace Account Deletion** notifications. Choose to apply for an **exemption**. This app doesn't store any eBay user data, so the exemption applies. It's usually approved right away.

## 4. OpenWeb Ninja: eBay sold prices (5 min)

1. Go to **openwebninja.com**, then sign up. The free plan needs no card.
2. Subscribe to the **Real-Time eBay Data** API on the **Free** plan (100 requests a month) for testing.
3. Copy your API key into `OPENWEBNINJA_API_KEY`.
4. When you launch, switch to **Pay As You Go** ($0.005 per request; each item uses 1–2).

> This is the most important source for price accuracy. The checker in step 5 tests it for real.

## 5. Check every key (5 min, needs Node 22+)

If you don't have Node.js, install the LTS version from **nodejs.org**. You can also skip this step and test on the live site after step 6.

```bash
cd depilot
npm install
cp .env.example .env.local      # then paste your values into .env.local
npm run check-setup
```

You want ✓ next to Supabase, Gemini, eBay and OpenWeb Ninja. Then price a real item from photos on your computer (costs about 3¢):

```bash
npm run try-item -- ~/Desktop/front.jpg ~/Desktop/tag.jpg
```

This prints the description, the price and every comp it used. If the OpenWeb Ninja line says it got results but no "Sold" dates, the provider's response format has probably changed; the parser is in `lib/pricing/sold.ts`.

To run the full app on your computer, use `npm run dev` and open http://localhost:3000. Google login needs step 7 first.

## 6. Put it online with GitHub and Vercel (15 min)

1. Create a **private** repository on **github.com** and upload this folder (see "Getting the code onto GitHub" at the end).
2. Go to **vercel.com**, sign up with GitHub, then **Add New**, then **Project**, and **Import** your repository.
3. **Before clicking Deploy**, open **Environment Variables** and add every value from your note. Also add:
   - `MONTHLY_LIMIT` = `50`, `MONTHLY_BUDGET_USD` = `75`
   - `ADMIN_EMAILS` = your Google email (optional; leave it out and nobody gets admin tools)
   - `CRON_SECRET` = any long random string (for example, run `openssl rand -hex 24` and paste the result). Vercel uses it to call the nightly photo cleanup.
   - `NEXT_PUBLIC_SITE_URL` = `https://YOUR-PROJECT.vercel.app` (you'll change this after step 8)
4. Click **Deploy**. Wait about 2 minutes, then note your address, like `https://your-project.vercel.app`.

> The `NEXT_PUBLIC_` values are built into the site. **Any time you change one, redeploy:** go to **Deployments**, open the menu on the newest one and choose **Redeploy**.

## 7. Google login (15 min)

**In Google Cloud** (console.cloud.google.com, same project as your Gemini key is fine):

1. Go to **Google Auth Platform**, then **Branding**. Set the app name, support email and developer email. For the **App logo**, upload a 120×120 PNG of your logo. Changing the logo later sends the Branding page back for verification.
2. Go to **Audience**. Set the user type to **External**, then click **Publish app** so it's "In production". Otherwise only test users you add by hand can sign in. This app asks only for name and email, so Google doesn't need to review it.
3. Go to **Clients**, then **Create client**, and choose **Web application**.
   - **Authorized JavaScript origins:** your Vercel address, plus your domain later, plus `http://localhost:3000`
   - **Authorized redirect URIs:** `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`. This is your Supabase Project URL with `/auth/v1/callback` added.
4. Copy the **Client ID** and **Client secret**.

**In Supabase:**

5. Go to **Authentication**, then **Sign In / Providers**, then **Google**. Turn it on, paste the Client ID and secret, and save.
6. On the same page, **turn OFF Email**. It's on by default. Turn off any other provider that's on, so Google is the only way in. The app also refuses non-Google accounts on its own, as a backstop.
7. Go to **Authentication**, then **URL Configuration**:
   - **Site URL:** your live address (Vercel now, your domain after step 8)
   - **Redirect URLs:** add `https://YOUR-ADDRESS/auth/callback` and `http://localhost:3000/auth/callback`. Exact addresses only, no `*` wildcards, so sign-in can't be sent anywhere else.
8. Open your site, click **Continue with Google**, and you're in.

> Google's sign-in screen will say "continue to abcdxyz.supabase.co" until Google verifies your branding. To show your app's name, submit the Branding page for verification (free, a few business days). Or add a Supabase custom domain (paid add-on). Neither blocks launch.

## 8. Your domain (10 min)

1. In Vercel, go to your project, then **Settings**, then **Domains**. Either **Buy** a domain there, or **Add** one you own and follow the DNS instructions.
2. Update everywhere your address appears:
   - Vercel env `NEXT_PUBLIC_SITE_URL` = `https://yourdomain.com`, then **Redeploy**
   - Supabase **Site URL** and **Redirect URLs** (step 7.7)
   - Google client **Authorized JavaScript origins** (step 7.3)
   - Stripe webhook URL, if you set it up (step 9)

> Avoid "depop" in your domain. It's Depop's trademark. The app name and support email live in `lib/app-config.ts`.

## 9. Optional, later: paid packs with Stripe

Paid packs are switched off by default. To turn them on: create a Stripe webhook pointing at `https://yourdomain.com/api/stripe/webhook` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`, then set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `PAID_PACKS_ENABLED=true` in Vercel and redeploy. Pack sizes live in `PACKS` in `lib/server/billing.ts`.

---

## Launch checklist

- [ ] Sign in with Google from a phone
- [ ] Upload 3 photos of one item (front, back, tag). The description appears, then the price swings in.
- [ ] Tap the confidence row. You should see sold comps with eBay or Depop links.
- [ ] Edit the price and the brand, then refresh the page. Your edits stay.
- [ ] Tap **Export**, then **Download for Depop**. Tap **Open Depop bulk listing** (depop.com/sellinghub/bulklisting), click **Upload file** and choose the file. It imports with photos.
- [ ] Settings: change location and shipping, then export again. The new values are in the CSV.
- [ ] Open Settings. The monthly meter counts your test uploads.
- [ ] Visit `/privacy` and `/terms`.
- [ ] In Vercel, go to **Settings**, then **Cron Jobs**. The cleanup job is listed. You can click **Run** once; it should return `{"listings":0,"files":0}` until photos are old enough.
- [ ] In Vercel, go to **Logs** and check for red errors after your test uploads.

## Costs at a glance

| | Cost |
|---|---|
| Vercel Hobby, Supabase Free | $0. Hobby allows a free project with a donation link. Supabase Free pauses after a week with no visits, so open the site now and then |
| Gemini | about 2.5–3.5¢ per listing (about 4–5¢ after Jan 2027, when Gemini 3.8 Flash's price doubles) |
| OpenWeb Ninja | $0.005 per request (1–2 per listing) on Pay As You Go |
| eBay | Free |
| Domain | about $10–20 a year |
| Worst case | 10 users at the full 50 listings each: about $18 a month now, about $26 in 2027. The `MONTHLY_BUDGET_USD` cap stops it at $75 whatever happens |

Photos are deleted 30 days after export (90 days if never exported) and the app shows small thumbnails, which keeps Supabase inside its free 1 GB storage and 5 GB bandwidth. If Supabase's usage page shows you near 70% of either, it's time to move photos to Cloudflare R2 or upgrade Supabase ($25 a month).

## Getting the code onto GitHub

The easiest way, without the command line:

1. Go to **github.com**, then **New repository**. Name it, choose **Private**, and click **Create**.
2. On the empty repo page, click **uploading an existing file**.
3. Drag in everything inside the unzipped folder, *except* `node_modules` and `.next` if they exist.
4. Click **Commit changes**.

With git installed:

```bash
cd depilot
git init -b main
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOU/REPO.git
git push -u origin main
```
