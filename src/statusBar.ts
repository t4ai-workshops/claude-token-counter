import * as vscode from "vscode";
import { CurrentSessionView } from "./types";

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

  update(view: CurrentSessionView): void {
    const format = vscode.workspace.getConfiguration("claudeTokenCounter").get<string>("statusBarFormat", "costAndContext");

    const model = view.modelDisplayName;
    const costStr = typeof view.costUsd === "number" ? `${view.costIsEstimate ? "~" : ""}$${view.costUsd.toFixed(3)}` : "$?";
    const pctStr = typeof view.contextUsedPercentage === "number" ? `${Math.round(view.contextUsedPercentage)}%` : "—";
    const tokensStr =
      typeof view.totalInputTokens === "number" && typeof view.totalOutputTokens === "number"
        ? `${fmt(view.totalInputTokens)} in / ${fmt(view.totalOutputTokens)} out`
        : "—";

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
    this.item.tooltip = buildTooltip(view);
  }
}

function fmt(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function buildTooltip(view: CurrentSessionView): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${view.modelDisplayName}**  \n`);
  if (typeof view.costUsd === "number") {
    md.appendMarkdown(`Session cost: **${view.costIsEstimate ? "~" : ""}$${view.costUsd.toFixed(4)}**${view.costIsEstimate ? " _(estimated)_" : ""}  \n`);
  }
  if (typeof view.totalInputTokens === "number" && typeof view.totalOutputTokens === "number") {
    md.appendMarkdown(`Tokens: ${view.totalInputTokens} in / ${view.totalOutputTokens} out`);
    if (typeof view.contextUsedPercentage === "number" && view.contextWindowSize) {
      md.appendMarkdown(` (context ${view.contextUsedPercentage.toFixed(1)}% of ${fmt(view.contextWindowSize)})`);
    }
    md.appendMarkdown("  \n");
  }
  if (typeof view.cacheReadTokens === "number" || typeof view.cacheCreationTokens === "number") {
    md.appendMarkdown(`Cache: ${view.cacheReadTokens ?? 0} read / ${view.cacheCreationTokens ?? 0} written  \n`);
  }
  if (view.rateLimits?.fiveHour) {
    md.appendMarkdown(`5h limit: ${view.rateLimits.fiveHour.usedPercentage.toFixed(0)}% used  \n`);
  }
  if (view.rateLimits?.sevenDay) {
    md.appendMarkdown(`7d limit: ${view.rateLimits.sevenDay.usedPercentage.toFixed(0)}% used  \n`);
  }
  if (view.costIsEstimate) {
    md.appendMarkdown(`\n_Estimated from Claude Code's transcript log — this session's chat panel doesn't report cost directly._  \n`);
  }
  md.appendMarkdown(`\nClick for the full dashboard.`);
  return md;
}
