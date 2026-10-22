export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export function serverEnv() {
  return {
    supabaseSecret: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    geminiKey: process.env.GEMINI_API_KEY || '',
    visionModel: process.env.GEMINI_VISION_MODEL || 'gemini-3.8-flash',
    fastModel: process.env.GEMINI_FAST_MODEL || 'gemini-3.5-flash-lite',
    visionThinking: process.env.GEMINI_VISION_THINKING || 'low',
    ebayClientId: process.env.EBAY_CLIENT_ID || '',
    ebayClientSecret: process.env.EBAY_CLIENT_SECRET || '',
    openWebNinjaKey: process.env.OPENWEBNINJA_API_KEY || '',
    webPrices: process.env.ENABLE_WEB_PRICES === 'true',
    monthlyLimit: Math.max(0, Number(process.env.MONTHLY_LIMIT || 50)),
    monthlyBudgetCents: Math.round(Math.max(0, Number(process.env.MONTHLY_BUDGET_USD || 75)) * 100),
    cronSecret: process.env.CRON_SECRET || '',
    adminEmails: (process.env.ADMIN_EMAILS || '')
      .split(',').map(e => e.trim().toLowerCase()).filter(Boolean),
    packsEnabled: process.env.PAID_PACKS_ENABLED === 'true',
    stripeSecret: process.env.STRIPE_SECRET_KEY || '',
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    siteUrl: (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  };
}
