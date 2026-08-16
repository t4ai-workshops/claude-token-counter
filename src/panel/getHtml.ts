import * as vscode from "vscode";
import { ProjectSummary, StatusLinePayload } from "../types";
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

function currentSessionSection(payload: StatusLinePayload | undefined): string {
  if (!payload) {
    return `<div class="empty">No active Claude Code session detected yet in this workspace.<br/>Start Claude Code in a terminal here to see live usage.</div>`;
  }

  const cost = payload.cost?.total_cost_usd;
  const cw = payload.context_window;
  const pricing = formatPricing(payload.model.id);
  const rl = payload.rate_limits;

  const rows: string[] = [];
  rows.push(row("Model", escapeHtml(payload.model.display_name) + (pricing ? ` <span class="muted">(${escapeHtml(pricing)})</span>` : "")));
  if (typeof cost === "number") rows.push(row("Session cost", fmtUsd(cost)));
  if (cw) {
    rows.push(row("Input tokens", fmtTokens(cw.total_input_tokens)));
    rows.push(row("Output tokens", fmtTokens(cw.total_output_tokens)));
    if (cw.current_usage) {
      rows.push(row("Cache read", fmtTokens(cw.current_usage.cache_read_input_tokens)));
      rows.push(row("Cache written", fmtTokens(cw.current_usage.cache_creation_input_tokens)));
    }
    if (typeof cw.used_percentage === "number") {
      rows.push(row("Context used", contextBar(cw.used_percentage) + ` ${cw.used_percentage.toFixed(1)}%`));
    }
  }
  if (rl?.five_hour) rows.push(row("5h limit", `${rl.five_hour.used_percentage.toFixed(0)}%`));
  if (rl?.seven_day) rows.push(row("7d limit", `${rl.seven_day.used_percentage.toFixed(0)}%`));

  return `<table class="kv">${rows.join("")}</table>`;
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

export function getDashboardHtml(
  webview: vscode.Webview,
  currentSession: StatusLinePayload | undefined,
  projects: ProjectSummary[]
): string {
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
