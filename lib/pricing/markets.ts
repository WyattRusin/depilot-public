export const CURRENCIES = {
  USD: { symbol: '$', ebayMarketplace: 'EBAY_US', ebayDomain: 'com', country: 'United States' },
  GBP: { symbol: '£', ebayMarketplace: 'EBAY_GB', ebayDomain: 'co.uk', country: 'United Kingdom' },
  EUR: { symbol: '€', ebayMarketplace: 'EBAY_DE', ebayDomain: 'de', country: 'Europe' },
  AUD: { symbol: 'A$', ebayMarketplace: 'EBAY_AU', ebayDomain: 'com.au', country: 'Australia' },
  CAD: { symbol: 'C$', ebayMarketplace: 'EBAY_CA', ebayDomain: 'ca', country: 'Canada' },
} as const;

export type Currency = keyof typeof CURRENCIES;
export const CURRENCY_CODES = Object.keys(CURRENCIES) as Currency[];

export function market(currency: string | null | undefined) {
  const code = (currency && currency in CURRENCIES ? currency : 'USD') as Currency;
  return { code, ...CURRENCIES[code] };
}
