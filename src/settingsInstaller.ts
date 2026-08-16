import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export type InstallScope = "workspace" | "global";

export function userSettingsPath(): string {
  return path.join(os.homedir(), ".claude", "settings.json");
}

export function workspaceSettingsPath(workspaceFolder: string): string {
  return path.join(workspaceFolder, ".claude", "settings.local.json");
}

function readJson(filePath: string): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeJson(filePath: string, data: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

function commandFor(bridgeScriptPath: string): string {
  // Quote for shell safety (spaces in the path are common, e.g. on macOS
  // under "~/Application Support/..." or project folders with spaces).
  return `node ${JSON.stringify(bridgeScriptPath)}`;
}

export interface ExistingStatusLineInfo {
  present: boolean;
  isOurs: boolean;
  raw?: unknown;
}

export function inspectStatusLine(filePath: string, bridgeScriptPath: string): ExistingStatusLineInfo {
  const data = readJson(filePath);
  const statusLine = data["statusLine"];
  if (!statusLine) return { present: false, isOurs: false };
  const command = (statusLine as { command?: string }).command ?? "";
  const isOurs = command.includes(bridgeScriptPath);
  return { present: true, isOurs, raw: statusLine };
}

/** Merge our statusLine block into the given settings file without
 * touching any other keys the user (or Claude Code itself) put there. */
export function installStatusLine(filePath: string, bridgeScriptPath: string): void {
  const data = readJson(filePath);
  data["statusLine"] = {
    type: "command",
    command: commandFor(bridgeScriptPath),
    padding: 1,
  };
  writeJson(filePath, data);
}

export function removeStatusLine(filePath: string, bridgeScriptPath: string): void {
  const data = readJson(filePath);
  const info = inspectStatusLine(filePath, bridgeScriptPath);
  if (info.present && info.isOurs) {
    delete data["statusLine"];
    writeJson(filePath, data);
  }
}
