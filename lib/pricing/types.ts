export type CompSource = 'ebay_sold' | 'ebay_image' | 'ebay_active' | 'web';
export type Match = 'same' | 'similar' | 'different';

export interface Comp {
  source: CompSource;
  status: 'sold' | 'listed';
  title: string;
  price: number;
  currency: string;
  url?: string;
  image?: string;
  condition?: string;
  site?: string;
  soldDate?: string;
  match?: Match;
  brandNamed?: string;
}

export interface Pricing {
  price: number | null;
  low: number | null;
  high: number | null;
  currency: string;
  confidence: number;
  confidenceLabel: 'High' | 'Medium' | 'Low';
  basis: 'sold' | 'market' | 'estimate' | 'none';
  summary: string;
  soldCount: number;
  listedCount: number;
  comps: Comp[];
  rejectedCount: number;
  aiPrice: number | null;
  steps: string[];
  sources: Record<CompSource, number>;
  errors?: string[];
  timings?: Record<string, number>;
  brandSuggestion?: { name: string; depopBrand: string; count: number; of: number } | null;
  judged?: Comp[];
  queries?: { exact: string; broad: string; web: boolean };
}
