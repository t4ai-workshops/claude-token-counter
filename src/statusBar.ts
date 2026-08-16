import * as vscode from "vscode";
import { StatusLinePayload } from "./types";

export class ClaudeStatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = "claudeTokenCounter.showDashboard";
    this.item.name = "Claude Token Counter";
    this.showIdle();
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }

  showIdle(): void {
    this.item.text = "$(sparkle) Claude: no session yet";
    this.item.tooltip = "Claude Token Counter — waiting for a Claude Code session in this workspace.";
  }

  update(payload: StatusLinePayload): void {
    const format = vscode.workspace.getConfiguration("claudeTokenCounter").get<string>("statusBarFormat", "costAndContext");

    const model = payload.model?.display_name ?? "Claude";
    const cost = payload.cost?.total_cost_usd;
    const pct = payload.context_window?.used_percentage;
    const inTok = payload.context_window?.total_input_tokens;
    const outTok = payload.context_window?.total_output_tokens;

    const costStr = typeof cost === "number" ? `$${cost.toFixed(3)}` : "$?";
    const pctStr = typeof pct === "number" ? `${Math.round(pct)}%` : "—";
    const tokensStr = typeof inTok === "number" && typeof outTok === "number" ? `${fmt(inTok)} in / ${fmt(outTok)} out` : "—";

    let text: string;
    switch (format) {
      case "tokensOnly":
        text = `$(sparkle) ${model} · ${tokensStr}`;
        break;
      case "costOnly":
        text = `$(sparkle) ${model} · ${costStr}`;
        break;
      default:
        text = `$(sparkle) ${model} · ${costStr} · ${pctStr} ctx`;
    }

    this.item.text = text;
    this.item.tooltip = buildTooltip(payload);
  }
}

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function buildTooltip(payload: StatusLinePayload): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${payload.model?.display_name ?? "Claude"}**  \n`);
  if (payload.cost) {
    md.appendMarkdown(`Session cost: **$${payload.cost.total_cost_usd.toFixed(4)}**  \n`);
  }
  const cw = payload.context_window;
  if (cw) {
    md.appendMarkdown(`Context: ${cw.total_input_tokens} in / ${cw.total_output_tokens} out`);
    if (typeof cw.used_percentage === "number") {
      md.appendMarkdown(` (${cw.used_percentage.toFixed(1)}% of ${fmt(cw.context_window_size)})`);
    }
    md.appendMarkdown("  \n");
    if (cw.current_usage) {
      md.appendMarkdown(
        `Cache: ${cw.current_usage.cache_read_input_tokens} read / ${cw.current_usage.cache_creation_input_tokens} written  \n`
      );
    }
  }
  if (payload.rate_limits?.five_hour) {
    md.appendMarkdown(`5h limit: ${payload.rate_limits.five_hour.used_percentage.toFixed(0)}% used  \n`);
  }
  if (payload.rate_limits?.seven_day) {
    md.appendMarkdown(`7d limit: ${payload.rate_limits.seven_day.used_percentage.toFixed(0)}% used  \n`);
  }
  md.appendMarkdown(`\nClick for the full dashboard.`);
  return md;
}
