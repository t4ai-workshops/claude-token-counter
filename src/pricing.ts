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

/** Default context window in tokens, per model. Snapshot date: 2026-08-16.
 * Used only for the transcript fallback's context% estimate — statusline
 * sessions get `context_window_size` straight from Claude Code itself. */
export const CONTEXT_WINDOW_SIZES: Record<string, number> = {
  "claude-fable-5": 1_000_000,
  "claude-mythos-5": 1_000_000,
  "claude-opus-5": 1_000_000,
  "claude-opus-4-8": 1_000_000,
  "claude-opus-4-7": 1_000_000,
  "claude-opus-4-6": 1_000_000,
  "claude-opus-4-5": 1_000_000,
  "claude-sonnet-5": 1_000_000,
  "claude-sonnet-4-6": 1_000_000,
  "claude-sonnet-4-5": 1_000_000,
  "claude-haiku-4-5": 200_000,
};

export function contextWindowSizeFor(modelId: string): number {
  return CONTEXT_WINDOW_SIZES[modelId] ?? 200_000;
}

/**
 * Rough cost estimate for one turn's token usage, used only when a session
 * has no statusline-reported cost (transcript-fallback sessions). Cache
 * write/read multipliers are the standard Anthropic ratios (~1.25x list
 * input price to write, ~0.1x to read) — an approximation, not the exact
 * billed figure, since the real rate depends on the 5m vs 1h cache TTL
 * actually used.
 */
export function estimateCostUsd(
  modelId: string,
  usage: { inputTokens: number; outputTokens: number; cacheCreationInputTokens: number; cacheReadInputTokens: number }
): number {
  const p = MODEL_PRICING[modelId];
  if (!p) return 0;
  const perTokenIn = p.input / 1_000_000;
  const perTokenOut = p.output / 1_000_000;
  return (
    usage.inputTokens * perTokenIn +
    usage.outputTokens * perTokenOut +
    usage.cacheCreationInputTokens * perTokenIn * 1.25 +
    usage.cacheReadInputTokens * perTokenIn * 0.1
  );
}
