/**
 * Shape of the JSON Claude Code pipes to a `statusLine` command via stdin.
 * Mirrors the documented schema at https://code.claude.com/docs/en/statusline
 * ("Full JSON schema" accordion). Every optional field really can be absent
 * or null per that doc — treat everything but `session_id`/`model`/`cwd` as
 * possibly missing.
 */
export interface StatusLinePayload {
  cwd: string;
  session_id: string;
  session_name?: string;
  prompt_id?: string;
  transcript_path?: string;
  version?: string;
  model: {
    id: string;
    display_name: string;
  };
  workspace: {
    current_dir: string;
    project_dir: string;
    added_dirs?: string[];
    git_worktree?: string;
    repo?: {
      host: string;
      owner: string;
      name: string;
    };
  };
  output_style?: { name: string };
  cost?: {
    total_cost_usd: number;
    total_duration_ms: number;
    total_api_duration_ms: number;
    total_lines_added: number;
    total_lines_removed: number;
  };
  context_window?: {
    total_input_tokens: number;
    total_output_tokens: number;
    context_window_size: number;
    used_percentage: number | null;
    remaining_percentage: number | null;
    current_usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens: number;
      cache_read_input_tokens: number;
    } | null;
  };
  exceeds_200k_tokens?: boolean;
  fast_mode?: boolean;
  effort?: { level: "low" | "medium" | "high" | "xhigh" | "max" };
  thinking?: { enabled: boolean };
  rate_limits?: {
    five_hour?: { used_percentage: number; resets_at: number };
    seven_day?: { used_percentage: number; resets_at: number };
  };
}

/** One line as written by the bridge script into events.jsonl. */
export interface StoredEvent {
  /** ISO timestamp when the bridge script received this update. */
  received_at: string;
  payload: StatusLinePayload;
}

/**
 * One `assistant`-type entry pulled from a Claude Code transcript file
 * (`~/.claude/projects/<project>/<session-id>.jsonl`). This is our
 * best-effort fallback for sessions that never trigger `statusLine` — most
 * notably ones driven by the official Claude Code VS Code extension's own
 * chat panel, which launches `claude` in a headless `--no-chrome
 * --output-format stream-json` mode with no terminal UI to render a status
 * line into. The transcript format is explicitly undocumented and can
 * change between Claude Code releases, so every field here is read
 * defensively and this whole path is opt-out via a setting.
 */
export interface TranscriptTurn {
  sessionId: string;
  cwd: string;
  timestamp: string;
  modelId: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
}

/** Rollup kept per session_id in history.json. */
export interface SessionSummary {
  sessionId: string;
  sessionName?: string;
  modelId: string;
  modelDisplayName: string;
  projectKey: string;
  projectLabel: string;
  firstSeen: string;
  lastSeen: string;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  /** Where this session's numbers came from — changes how they're
   * accumulated (statusline totals are cumulative snapshots to overwrite;
   * transcript turns are deltas to add up) and how cost is labeled. */
  source: "statusline" | "transcript";
  /** Context-in-use as of the most recent turn (not cumulative — this is a
   * point-in-time figure, unlike the token/cost totals above). Only
   * populated for transcript-sourced sessions; statusline sessions get the
   * equivalent straight from `context_window` and don't need it stored. */
  lastContextTokens?: number;
  lastContextWindowSize?: number;
}

/** What the status bar and dashboard actually render — populated either
 * directly from a statusline payload or synthesized from accumulated
 * transcript turns, so the UI code doesn't need to know which source it
 * came from. */
export interface CurrentSessionView {
  sessionId: string;
  modelId: string;
  modelDisplayName: string;
  costUsd?: number;
  costIsEstimate: boolean;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  contextUsedTokens?: number;
  contextWindowSize?: number;
  contextUsedPercentage?: number;
  rateLimits?: {
    fiveHour?: { usedPercentage: number };
    sevenDay?: { usedPercentage: number };
  };
}

/** Aggregated view across every session recorded for one project. */
export interface ProjectSummary {
  projectKey: string;
  projectLabel: string;
  sessionCount: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  lastSeen: string;
  byModel: Record<
    string,
    { modelDisplayName: string; totalCostUsd: number; totalInputTokens: number; totalOutputTokens: number }
  >;
}

export interface HistoryData {
  /** schema version, bump if the on-disk shape changes */
  version: 1;
  sessions: Record<string, SessionSummary>;
}
