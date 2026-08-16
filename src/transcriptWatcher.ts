import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { EventEmitter } from "events";
import { TranscriptTurn } from "./types";

const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");
const RESCAN_INTERVAL_MS = 30_000;

interface FileState {
  offset: number;
  pending: string; // partial trailing line carried over between reads
}

/**
 * Best-effort fallback for sessions that never trigger `statusLine` —
 * chiefly ones run through the official Claude Code VS Code extension's
 * own chat panel, which launches `claude` in a headless
 * `--no-chrome --output-format stream-json` mode. There's no terminal UI
 * in that mode, so `statusLine` (a terminal-only feature) never fires —
 * but Claude Code still writes a transcript file per session at
 * `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`, and every
 * `assistant`-type line in it carries the same per-turn `usage` object the
 * Messages API returns.
 *
 * This format is explicitly undocumented by Anthropic and can change
 * between Claude Code releases ("scripts that parse these files directly
 * can break on any release"). Every line is parsed defensively; a
 * malformed or unexpected shape is skipped, never thrown.
 */
export class TranscriptWatcher extends EventEmitter {
  private files = new Map<string, FileState>();
  private watchers: fs.FSWatcher[] = [];
  private rescanTimer: NodeJS.Timeout | undefined;
  private usingRecursiveWatch = false;

  start(): void {
    if (!fs.existsSync(PROJECTS_DIR)) return; // Claude Code has never run on this machine

    this.discoverAndArmExisting();

    try {
      const watcher = fs.watch(PROJECTS_DIR, { recursive: true }, (_event, filename) => {
        if (!filename || !filename.endsWith(".jsonl")) return;
        this.readNew(path.join(PROJECTS_DIR, filename));
      });
      this.watchers.push(watcher);
      this.usingRecursiveWatch = true;
    } catch {
      // Recursive fs.watch isn't supported on every platform (notably
      // Linux) — the periodic rescan below is the fallback there.
    }

    this.rescanTimer = setInterval(() => this.discoverAndArmExisting(), RESCAN_INTERVAL_MS);
    this.rescanTimer.unref?.();
  }

  stop(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
    if (this.rescanTimer) clearInterval(this.rescanTimer);
  }

  /** Finds project/session files we don't know about yet, and — without
   * recursive-watch support — re-reads every known file for growth. */
  private discoverAndArmExisting(): void {
    let projectDirs: string[];
    try {
      projectDirs = fs
        .readdirSync(PROJECTS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => path.join(PROJECTS_DIR, d.name));
    } catch {
      return;
    }

    for (const dir of projectDirs) {
      let entries: string[];
      try {
        entries = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry);
        if (!this.files.has(full)) {
          // Start at end-of-file: we only want turns from now on, not to
          // retroactively ingest an entire pre-existing session history.
          let size = 0;
          try {
            size = fs.statSync(full).size;
          } catch {
            /* file disappeared between readdir and stat — ignore */
          }
          this.files.set(full, { offset: size, pending: "" });
        }
      }
    }

    if (!this.usingRecursiveWatch) {
      for (const full of this.files.keys()) this.readNew(full);
    }
  }

  private readNew(filePath: string): void {
    let state = this.files.get(filePath);
    if (!state) {
      // fs.watch told us about a file before our periodic scan registered
      // it — arm it from the start so we don't miss its first turns.
      state = { offset: 0, pending: "" };
      this.files.set(filePath, state);
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return;
    }
    if (stat.size <= state.offset) return;

    let fd: number;
    try {
      fd = fs.openSync(filePath, "r");
    } catch {
      return;
    }
    try {
      const length = stat.size - state.offset;
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, state.offset);
      state.offset = stat.size;

      const chunk = state.pending + buffer.toString("utf8");
      const lines = chunk.split("\n");
      state.pending = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        this.parseAndEmit(line);
      }
    } finally {
      fs.closeSync(fd);
    }
  }

  private parseAndEmit(line: string): void {
    try {
      const obj = JSON.parse(line);
      if (obj?.type !== "assistant") return;

      const usage = obj.message?.usage;
      const modelId = obj.message?.model;
      if (!usage || typeof modelId !== "string" || typeof obj.sessionId !== "string" || typeof obj.cwd !== "string") {
        return;
      }

      const turn: TranscriptTurn = {
        sessionId: obj.sessionId,
        cwd: obj.cwd,
        timestamp: typeof obj.timestamp === "string" ? obj.timestamp : new Date().toISOString(),
        modelId,
        usage: {
          inputTokens: Number(usage.input_tokens) || 0,
          outputTokens: Number(usage.output_tokens) || 0,
          cacheCreationInputTokens: Number(usage.cache_creation_input_tokens) || 0,
          cacheReadInputTokens: Number(usage.cache_read_input_tokens) || 0,
        },
      };
      this.emit("turn", turn);
    } catch {
      // Undocumented format — skip whatever we can't parse rather than crash.
    }
  }
}
