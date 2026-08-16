import * as fs from "fs";
import * as path from "path";
import { DailyBucket, HistoryData, ProjectSummary, RateLimitSnapshot, SessionSummary, StatusLinePayload, TranscriptTurn } from "./types";
import { contextWindowSizeFor, estimateCostUsd } from "./pricing";

function projectKeyForDir(dir: string): { key: string; label: string } {
  return { key: `dir:${dir}`, label: path.basename(dir) || dir };
}

/** Local-time "YYYY-MM-DD" — day buckets follow the user's wall clock, not
 * UTC, since that's what "today" means when someone asks about it. */
function localDateKey(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Groups sessions into a "project" for the history rollup. Prefers the git
 * remote identity (stable even if the folder gets renamed or checked out to
 * a different path), then falls back to the launch directory, then cwd.
 */
export function projectKeyFor(payload: StatusLinePayload): { key: string; label: string } {
  const repo = payload.workspace?.repo;
  if (repo?.owner && repo?.name) {
    return { key: `repo:${repo.host}/${repo.owner}/${repo.name}`, label: `${repo.owner}/${repo.name}` };
  }
  const dir = payload.workspace?.project_dir || payload.workspace?.current_dir || payload.cwd || "unknown";
  return projectKeyForDir(dir);
}

export class HistoryStore {
  private data: HistoryData;

  constructor(private readonly filePath: string) {
    this.data = this.load();
  }

  private load(): HistoryData {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as HistoryData;
      if (parsed && (parsed.version === 1 || parsed.version === 2) && parsed.sessions) {
        // v1 files predate `daily`/`lastRateLimits` — backfill rather than
        // discard the sessions/projects history already on disk.
        return { version: 2, sessions: parsed.sessions, daily: parsed.daily ?? {}, lastRateLimits: parsed.lastRateLimits };
      }
    } catch {
      // No file yet, or corrupt — start fresh rather than crashing the extension.
    }
    return { version: 2, sessions: {}, daily: {} };
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    // Write to a temp file first so a crash mid-write can't corrupt history.json.
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.filePath);
  }

  private addToDailyBucket(timestamp: string, costUsd: number, inputTokens: number, outputTokens: number): void {
    if (costUsd <= 0 && inputTokens <= 0 && outputTokens <= 0) return;
    if (!this.data.daily) this.data.daily = {};
    const key = localDateKey(timestamp);
    const bucket = this.data.daily[key] ?? { date: key, totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0 };
    bucket.totalCostUsd += costUsd;
    bucket.totalInputTokens += inputTokens;
    bucket.totalOutputTokens += outputTokens;
    this.data.daily[key] = bucket;
  }

  /** Apply one statusline update. Statusline totals are cumulative per
   * session, so this is a plain overwrite keyed by session_id — safe to
   * call with the same or an older snapshot repeatedly. The day/week
   * rollup needs deltas though, so we diff against the previous snapshot
   * for this session before overwriting (clamped at 0 — a session cost
   * only ever goes up, but guard against `/clear` or a corrected reading). */
  applyPayload(payload: StatusLinePayload, receivedAt: string): void {
    const { key: projectKey, label: projectLabel } = projectKeyFor(payload);
    const usage = payload.context_window;
    const cost = payload.cost;

    const existing = this.data.sessions[payload.session_id];
    const newCost = cost?.total_cost_usd ?? existing?.totalCostUsd ?? 0;
    const newInput = usage?.total_input_tokens ?? existing?.totalInputTokens ?? 0;
    const newOutput = usage?.total_output_tokens ?? existing?.totalOutputTokens ?? 0;

    const summary: SessionSummary = {
      sessionId: payload.session_id,
      sessionName: payload.session_name,
      modelId: payload.model.id,
      modelDisplayName: payload.model.display_name,
      projectKey,
      projectLabel,
      firstSeen: existing?.firstSeen ?? receivedAt,
      lastSeen: receivedAt,
      totalCostUsd: newCost,
      totalInputTokens: newInput,
      totalOutputTokens: newOutput,
      cacheCreationInputTokens:
        usage?.current_usage?.cache_creation_input_tokens ?? existing?.cacheCreationInputTokens ?? 0,
      cacheReadInputTokens: usage?.current_usage?.cache_read_input_tokens ?? existing?.cacheReadInputTokens ?? 0,
      source: "statusline",
    };

    this.data.sessions[payload.session_id] = summary;

    this.addToDailyBucket(
      receivedAt,
      Math.max(0, newCost - (existing?.totalCostUsd ?? 0)),
      Math.max(0, newInput - (existing?.totalInputTokens ?? 0)),
      Math.max(0, newOutput - (existing?.totalOutputTokens ?? 0))
    );

    if (payload.rate_limits) {
      const prev = this.data.lastRateLimits;
      const snapshot: RateLimitSnapshot = {
        observedAt: receivedAt,
        fiveHourUsedPercentage: payload.rate_limits.five_hour?.used_percentage ?? prev?.fiveHourUsedPercentage,
        fiveHourResetsAt: payload.rate_limits.five_hour?.resets_at ?? prev?.fiveHourResetsAt,
        sevenDayUsedPercentage: payload.rate_limits.seven_day?.used_percentage ?? prev?.sevenDayUsedPercentage,
        sevenDayResetsAt: payload.rate_limits.seven_day?.resets_at ?? prev?.sevenDayResetsAt,
      };
      this.data.lastRateLimits = snapshot;
    }

    this.save();
  }

  /** Apply one transcript-derived turn (the fallback path for sessions
   * that never trigger statusline — see transcriptWatcher.ts). Unlike
   * statusline snapshots, transcript turns are per-message deltas, so
   * these accumulate instead of overwriting (which also means the day
   * bucket for a turn is exact, not diffed). A session already tracked
   * via statusline is left alone — that source is authoritative when both
   * are somehow available. */
  applyTranscriptTurn(turn: TranscriptTurn): void {
    const existing = this.data.sessions[turn.sessionId];
    if (existing?.source === "statusline") return;

    const { key: projectKey, label: projectLabel } = projectKeyForDir(turn.cwd);
    const addedCost = estimateCostUsd(turn.modelId, turn.usage);

    const summary: SessionSummary = {
      sessionId: turn.sessionId,
      modelId: turn.modelId,
      modelDisplayName: existing?.modelDisplayName ?? turn.modelId,
      projectKey,
      projectLabel,
      firstSeen: existing?.firstSeen ?? turn.timestamp,
      lastSeen: turn.timestamp,
      totalCostUsd: (existing?.totalCostUsd ?? 0) + addedCost,
      totalInputTokens: (existing?.totalInputTokens ?? 0) + turn.usage.inputTokens,
      totalOutputTokens: (existing?.totalOutputTokens ?? 0) + turn.usage.outputTokens,
      cacheCreationInputTokens: (existing?.cacheCreationInputTokens ?? 0) + turn.usage.cacheCreationInputTokens,
      cacheReadInputTokens: (existing?.cacheReadInputTokens ?? 0) + turn.usage.cacheReadInputTokens,
      source: "transcript",
      lastContextTokens: turn.usage.inputTokens + turn.usage.cacheCreationInputTokens + turn.usage.cacheReadInputTokens,
      lastContextWindowSize: contextWindowSizeFor(turn.modelId),
    };

    this.data.sessions[turn.sessionId] = summary;
    this.addToDailyBucket(turn.timestamp, addedCost, turn.usage.inputTokens, turn.usage.outputTokens);
    this.save();
  }

  getSession(sessionId: string): SessionSummary | undefined {
    return this.data.sessions[sessionId];
  }

  allSessions(): SessionSummary[] {
    return Object.values(this.data.sessions);
  }

  getLastRateLimits(): RateLimitSnapshot | undefined {
    return this.data.lastRateLimits;
  }

  /** The last `days` calendar days (today first), zero-filled for days
   * with no recorded activity so the UI can render a clean fixed-length
   * list without special-casing gaps. */
  dailySummaries(days: number): DailyBucket[] {
    const result: DailyBucket[] = [];
    const now = new Date();
    for (let i = 0; i < days; i++) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = localDateKey(d);
      result.push(this.data.daily?.[key] ?? { date: key, totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0 });
    }
    return result;
  }

  /** Rolling sum over the last `days` calendar days, today inclusive —
   * e.g. lastNDaysTotal(1) is "today", lastNDaysTotal(7) is "last 7 days". */
  lastNDaysTotal(days: number): { totalCostUsd: number; totalInputTokens: number; totalOutputTokens: number } {
    return this.dailySummaries(days).reduce(
      (acc, b) => ({
        totalCostUsd: acc.totalCostUsd + b.totalCostUsd,
        totalInputTokens: acc.totalInputTokens + b.totalInputTokens,
        totalOutputTokens: acc.totalOutputTokens + b.totalOutputTokens,
      }),
      { totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0 }
    );
  }

  /** Sum every recorded session, grouped by project. */
  projectSummaries(): ProjectSummary[] {
    const byProject = new Map<string, ProjectSummary>();

    for (const s of this.allSessions()) {
      let project = byProject.get(s.projectKey);
      if (!project) {
        project = {
          projectKey: s.projectKey,
          projectLabel: s.projectLabel,
          sessionCount: 0,
          totalCostUsd: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          lastSeen: s.lastSeen,
          byModel: {},
        };
        byProject.set(s.projectKey, project);
      }

      project.sessionCount += 1;
      project.totalCostUsd += s.totalCostUsd;
      project.totalInputTokens += s.totalInputTokens;
      project.totalOutputTokens += s.totalOutputTokens;
      if (s.lastSeen > project.lastSeen) project.lastSeen = s.lastSeen;

      const modelEntry = project.byModel[s.modelId] ?? {
        modelDisplayName: s.modelDisplayName,
        totalCostUsd: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
      };
      modelEntry.totalCostUsd += s.totalCostUsd;
      modelEntry.totalInputTokens += s.totalInputTokens;
      modelEntry.totalOutputTokens += s.totalOutputTokens;
      project.byModel[s.modelId] = modelEntry;
    }

    return Array.from(byProject.values()).sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
  }

  reset(): void {
    this.data = { version: 2, sessions: {}, daily: {} };
    this.save();
  }
}
