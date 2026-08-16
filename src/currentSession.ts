import { CurrentSessionView, SessionSummary, StatusLinePayload } from "./types";

export function fromStatusLinePayload(payload: StatusLinePayload): CurrentSessionView {
  const cw = payload.context_window;
  const rl = payload.rate_limits;
  return {
    sessionId: payload.session_id,
    modelId: payload.model.id,
    modelDisplayName: payload.model.display_name,
    costUsd: payload.cost?.total_cost_usd,
    costIsEstimate: false,
    totalInputTokens: cw?.total_input_tokens,
    totalOutputTokens: cw?.total_output_tokens,
    cacheReadTokens: cw?.current_usage?.cache_read_input_tokens,
    cacheCreationTokens: cw?.current_usage?.cache_creation_input_tokens,
    contextUsedTokens:
      cw?.current_usage != null
        ? cw.current_usage.input_tokens + cw.current_usage.cache_creation_input_tokens + cw.current_usage.cache_read_input_tokens
        : undefined,
    contextWindowSize: cw?.context_window_size,
    contextUsedPercentage: cw?.used_percentage ?? undefined,
    rateLimits:
      rl?.five_hour || rl?.seven_day
        ? {
            fiveHour: rl.five_hour ? { usedPercentage: rl.five_hour.used_percentage } : undefined,
            sevenDay: rl.seven_day ? { usedPercentage: rl.seven_day.used_percentage } : undefined,
          }
        : undefined,
  };
}

export function fromSessionSummary(summary: SessionSummary): CurrentSessionView {
  const pct =
    summary.lastContextTokens != null && summary.lastContextWindowSize
      ? (summary.lastContextTokens / summary.lastContextWindowSize) * 100
      : undefined;

  return {
    sessionId: summary.sessionId,
    modelId: summary.modelId,
    modelDisplayName: summary.modelDisplayName,
    costUsd: summary.totalCostUsd,
    costIsEstimate: summary.source === "transcript",
    totalInputTokens: summary.totalInputTokens,
    totalOutputTokens: summary.totalOutputTokens,
    cacheReadTokens: summary.cacheReadInputTokens,
    cacheCreationTokens: summary.cacheCreationInputTokens,
    contextUsedTokens: summary.lastContextTokens,
    contextWindowSize: summary.lastContextWindowSize,
    contextUsedPercentage: pct,
  };
}
