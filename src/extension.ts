import * as vscode from "vscode";
import { getStoragePaths } from "./paths";
import { writeBridgeScript } from "./bridgeScript";
import { HistoryStore } from "./historyStore";
import { EventWatcher } from "./eventWatcher";
import { TranscriptWatcher } from "./transcriptWatcher";
import { ClaudeStatusBar } from "./statusBar";
import { DashboardPanel } from "./panel/DashboardPanel";
import { registerCommands } from "./commands";
import { inspectStatusLine, userSettingsPath, workspaceSettingsPath } from "./settingsInstaller";
import { StoredEvent, TranscriptTurn } from "./types";
import { fromSessionSummary, fromStatusLinePayload } from "./currentSession";

export function activate(context: vscode.ExtensionContext): void {
  const paths = getStoragePaths(context);

  // Regenerate the bridge script on every activation so it's always in
  // sync with this version of the extension, and self-heals if the user
  // (or an OS cleanup) removed it from globalStorage.
  writeBridgeScript(paths);

  const history = new HistoryStore(paths.historyFile);
  const statusBar = new ClaudeStatusBar();
  const dashboard = new DashboardPanel(history);

  context.subscriptions.push(vscode.window.registerWebviewViewProvider(DashboardPanel.viewId, dashboard));
  context.subscriptions.push(statusBar);

  // A Claude Code session's cwd only matters to *this* window when we have
  // one to compare against — with no open folder, show whatever arrives.
  const currentWorkspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const isRelevant = (cwd: string) => !currentWorkspaceDir || cwd === currentWorkspaceDir;

  const watcher = new EventWatcher(paths.eventsLog);
  watcher.on("event", (evt: StoredEvent) => {
    history.applyPayload(evt.payload, evt.received_at);
    if (!isRelevant(evt.payload.cwd)) return;
    const view = fromStatusLinePayload(evt.payload);
    statusBar.update(view);
    dashboard.setCurrentSession(view);
  });
  watcher.start();
  context.subscriptions.push({ dispose: () => watcher.stop() });

  // Best-effort fallback for sessions statusLine never sees — chiefly the
  // official Claude Code extension's own chat panel (headless --no-chrome
  // mode has no terminal to render a status line into). Opt-out via
  // settings since it depends on Claude Code's undocumented transcript
  // format. See transcriptWatcher.ts for the full rationale.
  const transcriptEnabled = vscode.workspace.getConfiguration("claudeTokenCounter").get<boolean>("enableTranscriptFallback", true);
  let transcriptWatcher: TranscriptWatcher | undefined;
  if (transcriptEnabled) {
    transcriptWatcher = new TranscriptWatcher();
    transcriptWatcher.on("turn", (turn: TranscriptTurn) => {
      history.applyTranscriptTurn(turn);
      if (!isRelevant(turn.cwd)) return;
      const summary = history.getSession(turn.sessionId);
      if (!summary) return;
      const view = fromSessionSummary(summary);
      statusBar.update(view);
      dashboard.setCurrentSession(view);
    });
    transcriptWatcher.start();
    const tw = transcriptWatcher;
    context.subscriptions.push({ dispose: () => tw.stop() });
  }

  registerCommands(context, paths, history, () => dashboard.reveal());

  maybePromptToEnable(context, paths.bridgeScript);
}

export function deactivate(): void {
  // All cleanup is handled via context.subscriptions disposables.
}

async function maybePromptToEnable(context: vscode.ExtensionContext, bridgeScriptPath: string): Promise<void> {
  const dismissedKey = "claudeTokenCounter.dismissedSetupPrompt";
  if (context.globalState.get<boolean>(dismissedKey)) return;

  const folder = vscode.workspace.workspaceFolders?.[0];
  const workspaceInfo = folder ? inspectStatusLine(workspaceSettingsPath(folder.uri.fsPath), bridgeScriptPath) : undefined;
  const globalInfo = inspectStatusLine(userSettingsPath(), bridgeScriptPath);

  if (workspaceInfo?.isOurs || globalInfo.isOurs) return; // already set up somewhere relevant

  const choice = await vscode.window.showInformationMessage(
    "Claude Token Counter can show live token usage and cost from Claude Code right here in VS Code. Enable it now?",
    "Enable for This Workspace",
    "Enable Globally",
    "Not Now"
  );

  if (choice === "Enable for This Workspace") {
    await vscode.commands.executeCommand("claudeTokenCounter.enableForWorkspace");
  } else if (choice === "Enable Globally") {
    await vscode.commands.executeCommand("claudeTokenCounter.enableGlobally");
  } else {
    await context.globalState.update(dismissedKey, true);
  }
}
