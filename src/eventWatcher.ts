import * as fs from "fs";
import * as path from "path";
import { EventEmitter } from "events";
import { StoredEvent } from "./types";

const MAX_LOG_BYTES = 20 * 1024 * 1024; // rotate past ~20MB
const KEEP_LINES_ON_ROTATE = 3000;

/**
 * Tails events.jsonl (append-only, written by the standalone bridge
 * script) and emits a parsed StoredEvent for every new line. Reads only
 * the bytes appended since the last read, so this stays cheap even as the
 * log grows across a long-running VS Code session.
 */
export class EventWatcher extends EventEmitter {
  private offset = 0;
  private watcher: fs.FSWatcher | undefined;
  private pending = ""; // partial line carried over between reads

  constructor(private readonly logPath: string) {
    super();
  }

  start(): void {
    fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
    if (!fs.existsSync(this.logPath)) {
      fs.writeFileSync(this.logPath, "");
    }

    this.maybeRotate();
    // Start at end-of-file: we only want events from now on, not to replay
    // the entire history log as "new" events on every VS Code restart.
    // History (cumulative totals) already lives in history.json.
    this.offset = fs.statSync(this.logPath).size;

    const dir = path.dirname(this.logPath);
    const target = path.basename(this.logPath);
    this.watcher = fs.watch(dir, (_event, filename) => {
      if (filename && filename !== target) return;
      this.readNew();
    });
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = undefined;
  }

  private readNew(): void {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(this.logPath);
    } catch {
      return; // file briefly missing during rotation
    }

    if (stat.size < this.offset) {
      // File was truncated/rotated externally — read from the start again.
      this.offset = 0;
      this.pending = "";
    }
    if (stat.size === this.offset) return;

    const fd = fs.openSync(this.logPath, "r");
    try {
      const length = stat.size - this.offset;
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, this.offset);
      this.offset = stat.size;

      const chunk = this.pending + buffer.toString("utf8");
      const lines = chunk.split("\n");
      this.pending = lines.pop() ?? ""; // last element may be an incomplete line

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as StoredEvent;
          this.emit("event", parsed);
        } catch {
          // Skip a malformed line rather than dropping the whole batch.
        }
      }
    } finally {
      fs.closeSync(fd);
    }

    this.maybeRotate();
  }

  /** Keep the append-only log from growing without bound. Safe to call
   * often — it's a no-op below the size threshold. */
  private maybeRotate(): void {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(this.logPath);
    } catch {
      return;
    }
    if (stat.size <= MAX_LOG_BYTES) return;

    try {
      const content = fs.readFileSync(this.logPath, "utf8");
      const lines = content.split("\n").filter((l) => l.trim());
      const kept = lines.slice(-KEEP_LINES_ON_ROTATE);
      fs.writeFileSync(this.logPath, kept.join("\n") + (kept.length ? "\n" : ""));
      this.offset = fs.statSync(this.logPath).size;
      this.pending = "";
    } catch {
      // If rotation fails, leave the log as-is — better a big file than a crash.
    }
  }
}
