interface TokenPrice { input: number; output: number }

const AFTER_2027 = Date.UTC(2027, 0, 1);

function geminiPrice(model: string, now = Date.now()): TokenPrice {
  if (/^gemini-3\.(6|7|8)-flash$/.test(model)) {
    return now >= AFTER_2027 ? { input: 1.5, output: 7.5 } : { input: 0.75, output: 3.75 };
  }
  if (model === 'gemini-3.5-flash') return { input: 1.5, output: 9 };
  if (model === 'gemini-3.5-flash-lite') return { input: 0.3, output: 2.5 };
  if (model === 'gemini-3.1-flash-lite') return { input: 0.25, output: 1.5 };
  return { input: 1.5, output: 9 };
}

export const FLAT_CENTS = {
  googleSearch: 1.4,
  soldLookup: 0.5,
};

export class CostMeter {
  cents = 0;
  parts: Record<string, number> = {};

  add(label: string, cents: number) {
    if (!Number.isFinite(cents) || cents <= 0) return;
    this.cents += cents;
    this.parts[label] = (this.parts[label] || 0) + cents;
  }

  gemini(label: string, model: string, usage: { input: number; output: number; thoughts?: number }) {
    const p = geminiPrice(model);
    const usd = (usage.input * p.input + (usage.output + (usage.thoughts || 0)) * p.output) / 1_000_000;
    this.add(label, usd * 100);
  }
}
