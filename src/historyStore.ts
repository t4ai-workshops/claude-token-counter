import * as fs from "fs";
import * as path from "path";
import { HistoryData, ProjectSummary, SessionSummary, StatusLinePayload } from "./types";

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
  return { key: `dir:${dir}`, label: path.basename(dir) || dir };
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
      if (parsed && parsed.version === 1 && parsed.sessions) {
        return parsed;
      }
    } catch {
      // No file yet, or corrupt — start fresh rather than crashing the extension.
    }
    return { version: 1, sessions: {} };
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    // Write to a temp file first so a crash mid-write can't corrupt history.json.
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.filePath);
  }

  /** Apply one statusline update. Statusline totals are cumulative per
   * session, so this is a plain overwrite keyed by session_id — safe to
   * call with the same or an older snapshot repeatedly. */
  applyPayload(payload: StatusLinePayload, receivedAt: string): void {
    const { key: projectKey, label: projectLabel } = projectKeyFor(payload);
    const usage = payload.context_window;
    const cost = payload.cost;

    const existing = this.data.sessions[payload.session_id];
    const summary: SessionSummary = {
      sessionId: payload.session_id,
      sessionName: payload.session_name,
      modelId: payload.model.id,
      modelDisplayName: payload.model.display_name,
      projectKey,
      projectLabel,
      firstSeen: existing?.firstSeen ?? receivedAt,
      lastSeen: receivedAt,
      totalCostUsd: cost?.total_cost_usd ?? existing?.totalCostUsd ?? 0,
      totalInputTokens: usage?.total_input_tokens ?? existing?.totalInputTokens ?? 0,
      totalOutputTokens: usage?.total_output_tokens ?? existing?.totalOutputTokens ?? 0,
      cacheCreationInputTokens:
        usage?.current_usage?.cache_creation_input_tokens ?? existing?.cacheCreationInputTokens ?? 0,
      cacheReadInputTokens: usage?.current_usage?.cache_read_input_tokens ?? existing?.cacheReadInputTokens ?? 0,
    };

    this.data.sessions[payload.session_id] = summary;
    this.save();
  }

  getSession(sessionId: string): SessionSummary | undefined {
    return this.data.sessions[sessionId];
  }

  allSessions(): SessionSummary[] {
    return Object.values(this.data.sessions);
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
    this.data = { version: 1, sessions: {} };
    this.save();
  }
}
