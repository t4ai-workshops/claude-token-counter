import * as vscode from "vscode";
import { CurrentSessionView, DailyBucket, ProjectSummary, RateLimitSnapshot } from "../types";
import { formatPricing } from "../pricing";

export interface DashboardData {
  currentSession: CurrentSessionView | undefined;
  projects: ProjectSummary[];
  rateLimits: RateLimitSnapshot | undefined;
  today: { totalCostUsd: number; totalInputTokens: number; totalOutputTokens: number };
  last7Days: { totalCostUsd: number; totalInputTokens: number; totalOutputTokens: number };
  dailyBreakdown: DailyBucket[]; // today first
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}

function currentSessionSection(view: CurrentSessionView | undefined): string {
  if (!view) {
    return `<div class="empty">No active Claude Code session detected yet in this workspace.<br/>Start Claude Code (terminal, or the chat panel) to see live usage.</div>`;
  }

  const pricing = formatPricing(view.modelId);
  const rows: string[] = [];
  rows.push(row("Model", escapeHtml(view.modelDisplayName) + (pricing ? ` <span class="muted">(${escapeHtml(pricing)})</span>` : "")));

  if (typeof view.costUsd === "number") {
    const label = view.costIsEstimate ? `~${fmtUsd(view.costUsd)} <span class="muted">(estimated)</span>` : fmtUsd(view.costUsd);
    rows.push(row("Session cost", label));
  }
  if (typeof view.totalInputTokens === "number") rows.push(row("Input tokens", fmtTokens(view.totalInputTokens)));
  if (typeof view.totalOutputTokens === "number") rows.push(row("Output tokens", fmtTokens(view.totalOutputTokens)));
  if (typeof view.cacheReadTokens === "number") rows.push(row("Cache read", fmtTokens(view.cacheReadTokens)));
  if (typeof view.cacheCreationTokens === "number") rows.push(row("Cache written", fmtTokens(view.cacheCreationTokens)));
  if (typeof view.contextUsedPercentage === "number") {
    rows.push(row("Context used", contextBar(view.contextUsedPercentage) + ` ${view.contextUsedPercentage.toFixed(1)}%`));
  }

  const note = view.costIsEstimate
    ? `<div class="muted note">Estimated from Claude Code's transcript log — this session's chat panel doesn't report cost directly, so this is computed from token counts at list pricing.</div>`
    : "";

  return `<table class="kv">${rows.join("")}</table>${note}`;
}

function row(label: string, value: string): string {
  return `<tr><td class="label">${escapeHtml(label)}</td><td class="value">${value}</td></tr>`;
}

function contextBar(pct: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const color = clamped >= 90 ? "var(--vscode-charts-red)" : clamped >= 70 ? "var(--vscode-charts-yellow)" : "var(--vscode-charts-green)";
  return `<span class="bar"><span class="bar-fill" style="width:${clamped}%;background:${color}"></span></span>`;
}

function formatResetTime(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `today at ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} at ${time}`;
}

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function planLimitsSection(rateLimits: RateLimitSnapshot | undefined): string {
  if (!rateLimits || (rateLimits.fiveHourUsedPercentage == null && rateLimits.sevenDayUsedPercentage == null)) {
    return `<div class="empty">No plan-limit data yet. Only available when Claude Code runs in a terminal (statusline) — not the chat panel — and only for Claude.ai Pro/Max plans.</div>`;
  }

  const rows: string[] = [];
  if (rateLimits.fiveHourUsedPercentage != null) {
    rows.push(row("5-hour window", limitBar(rateLimits.fiveHourUsedPercentage) + ` ${rateLimits.fiveHourUsedPercentage.toFixed(0)}%`));
    if (rateLimits.fiveHourResetsAt) rows.push(row("↳ resets", escapeHtml(formatResetTime(rateLimits.fiveHourResetsAt))));
  }
  if (rateLimits.sevenDayUsedPercentage != null) {
    rows.push(row("7-day window", limitBar(rateLimits.sevenDayUsedPercentage) + ` ${rateLimits.sevenDayUsedPercentage.toFixed(0)}%`));
    if (rateLimits.sevenDayResetsAt) rows.push(row("↳ resets", escapeHtml(formatResetTime(rateLimits.sevenDayResetsAt))));
  }

  return `<table class="kv">${rows.join("")}</table><div class="muted note">As of ${escapeHtml(formatAge(rateLimits.observedAt))}, from your last terminal session.</div>`;
}

function limitBar(pct: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  const color = clamped >= 90 ? "var(--vscode-charts-red)" : clamped >= 70 ? "var(--vscode-charts-yellow)" : "var(--vscode-charts-blue)";
  return `<span class="bar"><span class="bar-fill" style="width:${clamped}%;background:${color}"></span></span>`;
}

function yourUsageSection(
  today: DashboardData["today"],
  last7Days: DashboardData["last7Days"],
  dailyBreakdown: DailyBucket[]
): string {
  const rows = [row("Today", fmtUsd(today.totalCostUsd) + ` <span class="muted">(${fmtTokens(today.totalInputTokens)} in / ${fmtTokens(today.totalOutputTokens)} out)</span>`)];
  rows.push(
    row("Last 7 days", fmtUsd(last7Days.totalCostUsd) + ` <span class="muted">(${fmtTokens(last7Days.totalInputTokens)} in / ${fmtTokens(last7Days.totalOutputTokens)} out)</span>`)
  );

  const maxCost = Math.max(...dailyBreakdown.map((d) => d.totalCostUsd), 0.0001);
  const dayLabels = new Intl.DateTimeFormat(undefined, { weekday: "short" });
  const bars = dailyBreakdown
    .slice()
    .reverse() // oldest first, left-to-right like a normal chart
    .map((d, i, arr) => {
      const isToday = i === arr.length - 1;
      const pct = Math.max(d.totalCostUsd > 0 ? 4 : 0, (d.totalCostUsd / maxCost) * 100);
      const label = isToday ? "Today" : dayLabels.format(new Date(d.date + "T12:00:00"));
      return `<div class="day-col" title="${escapeHtml(d.date)}: ${fmtUsd(d.totalCostUsd)}">
        <div class="day-bar-track"><div class="day-bar-fill" style="height:${pct}%"></div></div>
        <div class="day-col-label muted">${escapeHtml(label)}</div>
      </div>`;
    })
    .join("");

  return `<table class="kv">${rows.join("")}</table><div class="day-chart">${bars}</div>`;
}

export function getDashboardHtml(webview: vscode.Webview, data: DashboardData): string {
  const nonce = String(Date.now());
  const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource};`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    padding: 0 12px 16px;
  }
  h2 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--vscode-descriptionForeground);
    margin: 16px 0 6px;
    font-weight: 600;
  }
  .kv { width: 100%; border-collapse: collapse; }
  .kv td { padding: 2px 0; vertical-align: middle; }
  .kv .label { color: var(--vscode-descriptionForeground); width: 45%; }
  .kv .value { text-align: right; }
  .muted { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  .note { margin-top: 6px; line-height: 1.4; }
  .empty { color: var(--vscode-descriptionForeground); padding: 8px 0; line-height: 1.5; }
  .bar {
    display: inline-block;
    width: 60px;
    height: 6px;
    background: var(--vscode-progressBar-background, rgba(128,128,128,0.2));
    border-radius: 3px;
    overflow: hidden;
    vertical-align: middle;
    margin-right: 6px;
  }
  .bar-fill { display: block; height: 100%; }
  .project { margin-bottom: 10px; }
  .project-header { display: flex; justify-content: space-between; font-weight: 500; }
  .project-bar { width: 100%; height: 5px; margin: 3px 0; }
  .project-meta { font-size: 0.85em; }
  .day-chart {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    height: 64px;
    margin-top: 10px;
  }
  .day-col { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; }
  .day-bar-track {
    flex: 1;
    width: 100%;
    display: flex;
    align-items: flex-end;
  }
  .day-bar-fill {
    width: 100%;
    background: var(--vscode-charts-blue);
    border-radius: 2px 2px 0 0;
    min-height: 1px;
  }
  .day-col-label { font-size: 0.7em; margin-top: 3px; }
</style>
</head>
<body data-nonce="${nonce}">
  <h2>Current session</h2>
  ${currentSessionSection(data.currentSession)}

  <h2>Plan limits (Anthropic)</h2>
  ${planLimitsSection(data.rateLimits)}

  <h2>Your usage</h2>
  ${yourUsageSection(data.today, data.last7Days, data.dailyBreakdown)}

  <h2>Projects (all time)</h2>
  ${projectsSection(data.projects)}
</body>
</html>`;
}

function projectsSection(projects: ProjectSummary[]): string {
  if (projects.length === 0) {
    return `<div class="empty">No history recorded yet.</div>`;
  }
  const maxCost = Math.max(...projects.map((p) => p.totalCostUsd), 0.0001);

  const items = projects
    .map((p) => {
      const barPct = Math.max(2, (p.totalCostUsd / maxCost) * 100);
      const models = Object.values(p.byModel)
        .map((m) => escapeHtml(m.modelDisplayName))
        .join(", ");
      return `
      <div class="project">
        <div class="project-header">
          <span class="project-label">${escapeHtml(p.projectLabel)}</span>
          <span class="project-cost">${fmtUsd(p.totalCostUsd)}</span>
        </div>
        <span class="bar project-bar"><span class="bar-fill" style="width:${barPct}%;background:var(--vscode-charts-blue)"></span></span>
        <div class="project-meta muted">
          ${p.sessionCount} session${p.sessionCount === 1 ? "" : "s"} · ${fmtTokens(p.totalInputTokens)} in / ${fmtTokens(p.totalOutputTokens)} out · ${escapeHtml(models)}
        </div>
      </div>`;
    })
    .join("");

  return `<div class="projects">${items}</div>`;
}
