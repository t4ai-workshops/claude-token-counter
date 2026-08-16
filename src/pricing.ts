/**
 * Informational only — Claude Code already computes `cost.total_cost_usd`
 * itself from the actual token mix, and that figure is always what we
 * display as "the cost". This table only powers the small "$X.XX / $Y.YY
 * per MTok" hint next to the model name, and needs occasional updates as
 * Anthropic ships new models or pricing changes.
 *
 * Snapshot date: 2026-08-16. Prices in USD per million tokens.
 */
export interface ModelPricing {
  input: number;
  output: number;
  note?: string;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-fable-5": { input: 10, output: 50 },
  "claude-mythos-5": { input: 10, output: 50 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-opus-4-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15, note: "intro $2/$10 through 2026-08-31" },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

export function formatPricing(modelId: string): string | undefined {
  const p = MODEL_PRICING[modelId];
  if (!p) return undefined;
  return `$${p.input}/$${p.output} per MTok${p.note ? ` (${p.note})` : ""}`;
}
