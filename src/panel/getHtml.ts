import * as vscode from "vscode";
import { CurrentSessionView, ProjectSummary } from "../types";
import { formatPricing } from "../pricing";

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
  if (view.rateLimits?.fiveHour) rows.push(row("5h limit", `${view.rateLimits.fiveHour.usedPercentage.toFixed(0)}%`));
  if (view.rateLimits?.sevenDay) rows.push(row("7d limit", `${view.rateLimits.sevenDay.usedPercentage.toFixed(0)}%`));

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

export function getDashboardHtml(webview: vscode.Webview, currentSession: CurrentSessionView | undefined, projects: ProjectSummary[]): string {
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
</style>
</head>
<body data-nonce="${nonce}">
  <h2>Current session</h2>
  ${currentSessionSection(currentSession)}

  <h2>Projects (all time)</h2>
  ${projectsSection(projects)}
</body>
</html>`;
}
