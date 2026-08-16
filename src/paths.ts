import * as vscode from "vscode";
import * as path from "path";

/**
 * All on-disk locations this extension owns. Everything lives under the
 * extension's own globalStorage directory, which VS Code keys by extension
 * id (not version) — so the path stays stable across extension updates and
 * the bridge script (which runs standalone, outside VS Code) can keep
 * writing to it forever without us having to re-point Claude Code's config.
 */
export interface StoragePaths {
  root: string;
  bridgeScript: string;
  eventsLog: string;
  historyFile: string;
}

export function getStoragePaths(context: vscode.ExtensionContext): StoragePaths {
  const root = context.globalStorageUri.fsPath;
  return {
    root,
    bridgeScript: path.join(root, "statusline-bridge.cjs"),
    eventsLog: path.join(root, "events.jsonl"),
    historyFile: path.join(root, "history.json"),
  };
}
