# Claude Token Counter

Live token usage, cost, and context-window tracking for [Claude Code](https://code.claude.com), right in VS Code — a status bar item plus a sidebar dashboard with per-project history.

## How it works

Claude Code has no public extension API for reading its session state. The only officially documented, stable data source for live usage/cost is its [statusLine mechanism](https://code.claude.com/docs/en/statusline): Claude Code runs a script you configure and pipes it a JSON payload (tokens, cost, context %, rate limits, model) on stdin after every turn.

This extension:

1. Generates a small standalone Node.js script into its own storage folder.
2. Configures that script as Claude Code's `statusLine` command (workspace- or user-level `settings.json`).
3. The script appends every update it receives to an append-only log.
4. The extension tails that log, updates the VS Code status bar and sidebar in near real time, and rolls totals up into a local history file grouped by project.

### The catch: statusLine is a terminal-only feature

`statusLine` only fires when Claude Code is rendering an interactive terminal UI. Sessions started via the **official Claude Code VS Code extension's own chat panel** run `claude` headlessly (`--no-chrome --output-format stream-json`) — there's no terminal to draw a status line into, so it never triggers, and this extension would otherwise show nothing for that entire (very common) way of using Claude Code in VS Code.

To cover that case, the extension also **tails Claude Code's transcript files** (`~/.claude/projects/<project>/<session-id>.jsonl`) as a best-effort fallback, extracting the same per-turn `usage` data Claude Code writes there regardless of UI mode. This format is explicitly undocumented by Anthropic and can change between releases, so:

- It's used only for sessions that never sent a statusLine update — a session already tracked via statusLine is left alone.
- Cost is *estimated* from token counts at list pricing (shown with `~` and "estimated" in the UI) rather than reported by Claude Code itself, since the transcript doesn't include a running cost total.
- It can be turned off via `claudeTokenCounter.enableTranscriptFallback` if a future Claude Code release breaks the parsing (everything is read defensively and fails silent-skip, never crashes, but the numbers could go stale or wrong).

| How you run Claude Code | Data source |
|---|---|
| `claude` in a terminal (standalone, or VS Code's own integrated terminal) | statusLine (authoritative) |
| The official Claude Code extension's chat panel | transcript tailing (best-effort, estimated cost) |

## Setup

On first activation the extension offers to enable itself. You can also run these commands manually (`Cmd+Shift+P` / `Ctrl+Shift+P`):

- **Claude Token Counter: Enable for This Workspace** — writes to `.claude/settings.local.json` in the open folder (not committed to git by Claude Code convention).
- **Claude Token Counter: Enable Globally (All Projects)** — writes to `~/.claude/settings.json`, so every project gets tracked.

If you already have a custom `statusLine` configured, the extension asks before replacing it.

After enabling, start (or restart) Claude Code in a terminal in that workspace — the status bar updates after Claude's first response.

## What it shows

- **Status bar**: model, session cost, and context-window usage (configurable via `claudeTokenCounter.statusBarFormat`).
- **Sidebar panel** (Claude Token Counter icon in the Activity Bar): current session detail (tokens, cache read/write, rate limits on Pro/Max plans) plus all-time totals per project.

Cost is whatever Claude Code itself reports (`cost.total_cost_usd`) — computed client-side at list rates, so it may differ slightly from your actual invoice.

## Limitations

- Rate-limit percentages (`5h` / `7d`) only appear for Claude.ai Pro/Max subscribers; not for API-key/console billing.
- Requires `node` to be resolvable from the shell Claude Code runs in (true for any machine that has Claude Code installed).
- Windows without Git Bash: statusLine commands run through PowerShell instead of bash; the generated `node "<path>"` command should still work, but this hasn't been tested there.

## Development

```bash
npm install
npm run watch   # esbuild in watch mode
```

Press `F5` in VS Code to launch an Extension Development Host with the extension loaded.
