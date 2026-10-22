<p align="center">
  <img src="public/icon.svg" width="72" height="72" alt="Depilot logo">
</p>

<h1 align="center">Depilot</h1>

<p align="center">
  <b>Your Depop listings, written and priced from a few photos.</b><br>
  <a href="https://depilot.app"><b>Try it live → depilot.app</b></a>
</p>

---

Depilot turns a handful of phone photos into a ready-to-post Depop listing. It reads the tag, writes a description tuned for Depop search, and prices the item from what the **same item actually sold for**. Then it exports everything as a Depop bulk-listing CSV, photos included.

**Live app:** [https://depilot.app](https://depilot.app)

## What it does

- **Photo → listing in about 15 seconds.** Upload a front, back and tag. You get the title, description, brand, size, era, colour, condition and the exact Depop category.
- **Prices from real sales, not guesses.** It pulls eBay *sold* prices and live listings, and an AI judge compares each comp's photo with yours (same / similar / different). Only real matches count toward the weighted median.
- **Draggable price chart.** See every sold comp on a strip, the suggested price, and the quick-sale / patient range. Drag to set your own.
- **Honest about evidence.** A brand must be spelled out on the tag, a logo alone never dates an item, and measurements only come from a tape measure visible in a photo.
- **Automatic photo order.** The cover, back, tag, care label, close-ups, flaws and measurements are sorted into Depop's preferred order.
- **One-click Depop export.** A bulk-listing CSV built against Depop's Template v6 that imports with photos.
- **Phone-first, desktop-ready.** A one-item-per-page queue on phones; a card grid with keyboard navigation and drag-and-drop on desktop. Light and dark themes.

## How one item flows

```
phone ──(photo ~300 KB + thumbnail ~30 KB)──▶ Storage
  │
  ├─▶ POST /api/listings
  │     quick model sorts photos: front → back → tag → care → close-ups → flaws → tape measure
  │     eBay image search finds look-alike listings from the cover photo
  │     vision model reads the labelled photos and writes the listing
  │     tag guard: brand must be on the tag; a logo alone dates nothing
  │     measurements: only numbers read off a tape measure
  │     quick model picks the exact Depop category
  │     ◀── description appears (~5–15 s)
  │
  └─▶ POST /api/listings/:id/price
        eBay SOLD prices  ┐ in parallel; a broader sold search runs
        eBay live listings┘ only if fewer than 3 are found
        AI judge compares each comp photo with yours
        vintage comps can't price a modern item, and vice versa
        weighted median (recent sales count more) → condition → round
        ◀── price appears
```

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Auth, database, storage | Supabase (Google sign-in only, Postgres with RLS, private photo bucket) |
| AI | Google Gemini: a vision model for reading items, a fast model for sorting and judging |
| Price data | eBay Browse API (live listings + image search), OpenWeb Ninja (eBay sold prices) |
| Hosting | Vercel, with a nightly cron for photo cleanup |
| Payments (built, off) | Stripe Checkout + webhooks for optional listing packs |

## Project layout

| Path | What |
|---|---|
| `lib/depop/` | Depop template data (v6), the listing prompt, tag guard, brand / size / era rules, CSV export |
| `lib/pricing/` | The pricing engine: sources, AI judge, price maths (`estimate.ts`), cost table (`cost.ts`) |
| `lib/server/service.ts` | App logic: limits, budget, analyse, price, rewrite, edit, export, photo cleanup |
| `lib/server/billing.ts` | Optional paid packs (switched off by default) |
| `app/api/` | HTTP routes (thin wrappers around `service.ts`) |
| `components/` | The interface: `App.tsx` (layout per device), `Queue.tsx`, `ItemView.tsx`, `Grid.tsx`, `PricePlot.tsx`, `Sheets.tsx`, `Settings.tsx` |
| `app/globals.css` | All styling and design tokens (light and dark) |
| `supabase/` | Schema, row-level security, storage bucket and migrations |
| `tests/` | Unit tests for pricing, dating, sizes, the tag guard, CSV export, auth and billing |

## Pricing maths, briefly

1. Each matched comp becomes a sale-equivalent price. Sold prices count as-is; asking prices are discounted, because listings that sit unsold run above what things actually sell for.
2. Each comp gets a weight: same item > similar item, sold > listed, recent > old.
3. Outliers are trimmed (IQR) and the **weighted median** becomes the market price, so one silly listing can't drag the number.
4. A condition factor is applied, then the price is rounded to a point resellers actually use.
5. With too little evidence, the model's own estimate is used and clearly labelled.

## Security

- Every API route checks the session on the server, and every query is scoped to the signed-in user. The browser can't read or write tables directly (RLS on, no policies); it can only upload photos into its own folder.
- Paid actions run one at a time per item and are rate-limited, and saves use optimistic concurrency, so edits and re-prices never overwrite each other.
- Strict security headers (CSP, no framing, HSTS, nosniff) are set, and request bodies over 64 KB are refused.
- Exported CSV cells can't execute as spreadsheet formulas, and comp links are https-only.
- A global monthly spend cap pauses new uploads before AI costs can run away.
- All credentials come from environment variables. None are stored in this repository.

## Running it yourself

```bash
npm install
cp .env.example .env.local   # fill in your own keys
npm run dev                  # http://localhost:3000
npm test                     # all unit tests, no keys or internet needed
npm run typecheck
```

[SETUP.md](SETUP.md) walks through creating the Supabase, Gemini, eBay and OpenWeb Ninja accounts and deploying to Vercel.

### Environment variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase project (public) |
| `SUPABASE_SECRET_KEY` | Supabase server key (secret) |
| `GEMINI_API_KEY` | Google Gemini |
| `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` | eBay production keyset |
| `OPENWEBNINJA_API_KEY` | eBay sold-price data |
| `MONTHLY_LIMIT`, `MONTHLY_BUDGET_USD` | Free listings per user, global spend cap |
| `ADMIN_EMAILS` | Optional comma-separated Google emails with admin tools |
| `CRON_SECRET` | Shared secret for the nightly cleanup job |
| `ENABLE_WEB_PRICES` | Optional extra price source via Google Search |
| `PAID_PACKS_ENABLED`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Optional paid packs |
| `NEXT_PUBLIC_COFFEE_URL` | Optional tip-jar link shown in the footer |
| `NEXT_PUBLIC_SITE_URL` | Public URL, used for login redirects |

---

<p align="center">
  <a href="https://depilot.app">depilot.app</a> · Not affiliated with Depop, eBay or Google.
</p>
