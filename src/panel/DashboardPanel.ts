import * as vscode from "vscode";
import { CurrentSessionView } from "../types";
import { HistoryStore } from "../historyStore";
import { getDashboardHtml } from "./getHtml";

export class DashboardPanel implements vscode.WebviewViewProvider {
  static readonly viewId = "claudeTokenCounter.dashboard";

  private view: vscode.WebviewView | undefined;
  private currentSession: CurrentSessionView | undefined;

  constructor(private readonly history: HistoryStore) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: false };
    this.render();
  }

  setCurrentSession(view: CurrentSessionView): void {
    this.currentSession = view;
    this.render();
  }

  refresh(): void {
    this.render();
  }

  reveal(): void {
    // A webview view in the sidebar is revealed via the command that
    // focuses its container; VS Code handles this through package.json's
    // view id, so nothing extra is needed here beyond ensuring it renders.
    this.render();
  }

  private render(): void {
    if (!this.view) return;
    this.view.webview.html = getDashboardHtml(this.view.webview, {
      currentSession: this.currentSession,
      projects: this.history.projectSummaries(),
      rateLimits: this.history.getLastRateLimits(),
      today: this.history.lastNDaysTotal(1),
      last7Days: this.history.lastNDaysTotal(7),
      dailyBreakdown: this.history.dailySummaries(7),
    });
  }
}
