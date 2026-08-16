import * as vscode from "vscode";
import { HistoryStore } from "./historyStore";
import { inspectStatusLine, installStatusLine, userSettingsPath, workspaceSettingsPath } from "./settingsInstaller";
import { StoragePaths } from "./paths";

async function confirmOverwriteIfNeeded(filePath: string, bridgeScriptPath: string, scopeLabel: string): Promise<boolean> {
  const info = inspectStatusLine(filePath, bridgeScriptPath);
  if (!info.present || info.isOurs) return true;

  const choice = await vscode.window.showWarningMessage(
    `${scopeLabel} already has a custom statusLine configured in Claude Code settings. Replace it with Claude Token Counter's?`,
    { modal: true },
    "Replace",
    "Cancel"
  );
  return choice === "Replace";
}

export function registerCommands(context: vscode.ExtensionContext, paths: StoragePaths, history: HistoryStore, reveal: () => void): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("claudeTokenCounter.enableForWorkspace", async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showErrorMessage("Open a workspace folder first.");
        return;
      }
      const target = workspaceSettingsPath(folder.uri.fsPath);
      const ok = await confirmOverwriteIfNeeded(target, paths.bridgeScript, "This workspace");
      if (!ok) return;
      installStatusLine(target, paths.bridgeScript);
      vscode.window.showInformationMessage(
        "Claude Token Counter enabled for this workspace. Start (or restart) Claude Code here to see live usage."
      );
    }),

    vscode.commands.registerCommand("claudeTokenCounter.enableGlobally", async () => {
      const target = userSettingsPath();
      const ok = await confirmOverwriteIfNeeded(target, paths.bridgeScript, "Your global Claude Code settings");
      if (!ok) return;
      installStatusLine(target, paths.bridgeScript);
      vscode.window.showInformationMessage("Claude Token Counter enabled globally for every project.");
    }),

    vscode.commands.registerCommand("claudeTokenCounter.showDashboard", async () => {
      await vscode.commands.executeCommand("claudeTokenCounter.dashboard.focus");
      reveal();
    }),

    vscode.commands.registerCommand("claudeTokenCounter.resetHistory", async () => {
      const choice = await vscode.window.showWarningMessage(
        "Clear all stored Claude Code usage history? This cannot be undone.",
        { modal: true },
        "Clear History"
      );
      if (choice === "Clear History") {
        history.reset();
        vscode.window.showInformationMessage("Claude Token Counter history cleared.");
      }
    })
  );
}
