import * as vscode from "vscode";
import { getStoragePaths } from "./paths";
import { writeBridgeScript } from "./bridgeScript";
import { HistoryStore } from "./historyStore";
import { EventWatcher } from "./eventWatcher";
import { ClaudeStatusBar } from "./statusBar";
import { DashboardPanel } from "./panel/DashboardPanel";
import { registerCommands } from "./commands";
import { inspectStatusLine, userSettingsPath, workspaceSettingsPath } from "./settingsInstaller";
import { StoredEvent } from "./types";

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

  const watcher = new EventWatcher(paths.eventsLog);
  watcher.on("event", (evt: StoredEvent) => {
    history.applyPayload(evt.payload, evt.received_at);
    statusBar.update(evt.payload);
    dashboard.setCurrentSession(evt.payload);
  });
  watcher.start();
  context.subscriptions.push({ dispose: () => watcher.stop() });

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
