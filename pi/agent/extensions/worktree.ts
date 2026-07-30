/**
 * Git Worktree Extension
 *
 * Manage git worktrees from within pi with a vim-driven picker UI.
 *
 * Commands:
 *   /wt                 Open the worktree picker
 *   /wt new [name]      Create a new worktree (prompts for name if omitted)
 *   /wt return          Return to the original (main) project worktree
 *
 * Picker keybindings (vim motions):
 *   j / ↓       move down
 *   k / ↑       move up
 *   g / G       jump to top / bottom
 *   /           start filtering (type to search, enter to apply, esc to clear)
 *   n           create a new worktree (prompts for a name inline)
 *   d           delete the selected worktree (confirm with y)
 *   enter       switch pi into the selected worktree (relaunches pi there)
 *   q / esc     close the picker
 *
 * Worktree storage:
 *   New worktrees are created as siblings of the main repo:
 *     <parent>/<repo>-worktrees/<name>
 *   Override the base directory with the PI_WORKTREE_DIR environment variable
 *   (absolute path, or relative to the current working directory).
 */

import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import {
  Key,
  decodeKittyPrintable,
  matchesKey,
  parseKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TUI,
} from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorktreeInfo {
  /** Absolute path to the worktree. */
  path: string;
  /** Branch short name, or null when detached/bare. */
  branch: string | null;
  /** HEAD commit sha. */
  head: string;
  /** True for a bare worktree. */
  bare: boolean;
  /** True for the main (first) worktree. */
  isMain: boolean;
}

type Mode = "normal" | "search" | "newName" | "confirmDelete";

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

/** Run `git worktree list --porcelain` and parse the result. Returns null on failure. */
async function listWorktrees(pi: ExtensionAPI, cwd: string): Promise<WorktreeInfo[] | null> {
  const res = await pi.exec("git", ["worktree", "list", "--porcelain"], { cwd });
  if (res.code !== 0) return null;
  return parseWorktreePorcelain(res.stdout);
}

function parseWorktreePorcelain(text: string): WorktreeInfo[] {
  const result: WorktreeInfo[] = [];
  const blocks = text.replace(/\r\n/g, "\n").split("\n\n");
  let index = 0;
  for (const block of blocks) {
    if (!block.trim()) continue;
    let path = "";
    let branch: string | null = null;
    let head = "";
    let bare = false;
    let detached = false;
    for (const line of block.split("\n")) {
      const idx = line.indexOf(" ");
      const key = idx === -1 ? line : line.slice(0, idx);
      const val = idx === -1 ? "" : line.slice(idx + 1);
      switch (key) {
        case "worktree":
          path = val;
          break;
        case "HEAD":
          head = val;
          break;
        case "branch":
          branch = val.replace(/^refs\/heads\//, "");
          break;
        case "bare":
          bare = true;
          break;
        case "detached":
          detached = true;
          break;
      }
    }
    if (!path) continue;
    if (detached) branch = null;
    result.push({ path, branch, head, bare, isMain: index === 0 });
    index++;
  }
  return result;
}

/** Compute the base directory where new worktrees are created. */
function getWorktreeBase(mainToplevel: string, cwd: string): string {
  const env = process.env.PI_WORKTREE_DIR;
  if (env && env.trim()) return resolve(cwd, env.trim());
  const parent = dirname(mainToplevel);
  const name = basename(mainToplevel);
  return join(parent, `${name}-worktrees`);
}

/** Validate a worktree/branch name. */
function validName(name: string): boolean {
  return (
    /^[A-Za-z0-9._][A-Za-z0-9._/-]*$/.test(name) &&
    !name.includes("..") &&
    !name.endsWith("/") &&
    !name.endsWith(".lock")
  );
}

interface CreateResult {
  ok: boolean;
  path?: string;
  error?: string;
}

/** Create a new worktree for the given name (new branch, or checkout existing branch). */
async function createWorktree(pi: ExtensionAPI, cwd: string, name: string): Promise<CreateResult> {
  if (!validName(name)) {
    return { ok: false, error: `Invalid name "${name}". Use letters, digits, ., _, -, /.` };
  }
  const list = await listWorktrees(pi, cwd);
  if (!list) return { ok: false, error: "Not a git repository." };
  const main = list.find((w) => w.isMain) ?? list[0];
  if (!main) return { ok: false, error: "Could not determine the main worktree." };
  const base = getWorktreeBase(main.path, cwd);
  const target = join(base, name);

  // If the branch already exists, check it out into a new worktree; otherwise create it.
  const ref = await pi.exec("git", ["show-ref", "--verify", "--quiet", `refs/heads/${name}`], { cwd });
  const args = ref.code === 0 ? ["worktree", "add", target, name] : ["worktree", "add", "-b", name, target];
  const res = await pi.exec("git", args, { cwd });
  if (res.code !== 0) {
    return { ok: false, error: (res.stderr || res.stdout).trim() || "git worktree add failed." };
  }
  return { ok: true, path: target };
}

interface DeleteResult {
  ok: boolean;
  error?: string;
}

/** Remove a linked worktree. */
async function deleteWorktree(pi: ExtensionAPI, cwd: string, target: string): Promise<DeleteResult> {
  const res = await pi.exec("git", ["worktree", "remove", target], { cwd });
  if (res.code !== 0) {
    return { ok: false, error: (res.stderr || res.stdout).trim() || "git worktree remove failed." };
  }
  return { ok: true };
}

/** Resolve a path to its real (symlink-free) form, falling back to the input on error. */
function realPath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** Abbreviate a home directory prefix to `~`. */
function abbrevHome(p: string, home: string): string {
  if (p === home) return "~";
  if (p.startsWith(home + "/")) return "~" + p.slice(home.length);
  return p;
}

/** Keep the tail of a path (with a leading ellipsis) so the distinguishing name stays visible. */
function truncatePathLeft(p: string, maxWidth: number): string {
  const w = visibleWidth(p);
  if (w <= maxWidth) return p;
  if (maxWidth <= 1) return "…";
  return "…" + p.slice(-(maxWidth - 1));
}

// ---------------------------------------------------------------------------
// Relaunch pi in a different working directory
// ---------------------------------------------------------------------------

/**
 * Minimal component used while the replacement pi runs. The TUI is stopped
 * the whole time this is mounted, so it never actually renders.
 */
class HandoffComponent implements Component {
  render(_width: number): string[] {
    return [];
  }
  invalidate(): void {}
  handleInput(_data: string): void {}
}

interface SwitchResult {
  ok: boolean;
  error?: string;
}

/**
 * Run a fresh pi process in `targetCwd` on this terminal, then shut down the
 * current pi once it exits. This is how "switching" worktrees is implemented,
 * since pi's working directory is fixed for a session.
 *
 * Why supervision instead of spawn-then-exit: a previous version spawned the
 * new pi behind a sync pipe and immediately shut the current pi down. The
 * moment the old pi exited, its process group became orphaned and the parent
 * shell reclaimed the terminal's foreground process group, so the new pi -
 * now in an orphaned background process group - crashed in TUI startup with
 * `setRawMode EIO` (tcsetattr from an orphaned background group fails with
 * EIO instead of raising SIGTTOU). That race is unwinnable: the shell always
 * wins the terminal before node can boot.
 *
 * Instead, this mirrors pi's own external-editor handover: stop the TUI (which
 * restores cooked mode and releases stdin), run the child pi in the same
 * process group, and keep the current process alive - and therefore the
 * process group non-orphaned and the shell asleep - until the child exits.
 */
async function switchPiTo(targetCwd: string, ctx: ExtensionContext): Promise<SwitchResult> {
  const script = process.argv[1];
  if (!script) {
    return { ok: false, error: "Cannot relaunch pi: unable to determine the pi executable." };
  }
  const piArgs = [...process.execArgv, script];

  // ctx.ui.custom hands us the live TUI instance so we can stop/start it
  // around the child process, like pi does for external editors.
  return ctx.ui.custom<SwitchResult>((tui, _theme, _kb, done) => {
    // Keep the event loop alive while supervising, so this process cannot
    // drain-exit (and orphan the child's process group) even if every other
    // ref'ed handle closes. Mirrors pi's own suspend keep-alive.
    const keepAlive = setInterval(() => {}, 2 ** 30);
    let settled = false;
    const finish = (result: SwitchResult) => {
      if (settled) return;
      settled = true;
      clearInterval(keepAlive);
      // Bring pi's TUI back before resolving so the caller's shutdown (or
      // error reporting) happens against a running UI.
      try {
        tui.start();
      } catch {
        // If the terminal is gone there is nothing to restore.
      }
      done(result);
    };

    // Stop pi's TUI: restores the previous terminal mode, removes stdin
    // listeners and pauses stdin, so the child pi gets the terminal cleanly.
    tui.stop();
    process.stdout.write(`Switching to worktree: ${targetCwd}\n`);

    let child;
    try {
      child = spawn(process.execPath, piArgs, {
        cwd: targetCwd,
        stdio: "inherit",
        env: process.env,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Failed to launch pi: ${msg}\n`);
      finish({ ok: false, error: msg });
      return new HandoffComponent();
    }
    child.on("error", (err) => {
      process.stderr.write(`Failed to launch pi: ${err.message}\n`);
      finish({ ok: false, error: err.message });
    });
    child.on("exit", () => finish({ ok: true }));

    return new HandoffComponent();
  });
}

/**
 * Switch pi into `targetCwd`: run the replacement pi on this terminal and,
 * once it exits, shut this pi down. On launch failure, stays in the current
 * session and reports the error.
 */
async function relaunchPi(targetCwd: string, ctx: ExtensionContext): Promise<void> {
  const result = await switchPiTo(targetCwd, ctx);
  if (!result.ok) {
    ctx.ui.notify(result.error ?? "Failed to launch pi.", "error");
    return;
  }
  ctx.shutdown();
}

// ---------------------------------------------------------------------------
// Input helpers
// ---------------------------------------------------------------------------

/** Extract a single printable character from raw terminal input, if any. */
function getPrintableChar(data: string): string | undefined {
  const kitty = decodeKittyPrintable(data);
  if (kitty !== undefined) return kitty;
  const key = parseKey(data);
  if (key === undefined) return undefined;
  // shift+letter -> uppercase
  if (key.startsWith("shift+") && key.length === 7) {
    const c = key.slice(6);
    if (/^[a-z]$/.test(c)) return c.toUpperCase();
  }
  if (key.length === 1 && /[\x20-\x7e]/.test(key)) return key;
  return undefined;
}

// ---------------------------------------------------------------------------
// Worktree picker component
// ---------------------------------------------------------------------------

interface PickerOptions {
  pi: ExtensionAPI;
  ctx: ExtensionContext;
  tui: TUI;
  theme: Theme;
  worktrees: WorktreeInfo[];
  currentPath: string;
  home: string;
  /** Called with the chosen worktree path to switch to, or undefined to just close. */
  done: (result: string | undefined) => void;
}

class WorktreePicker implements Component {
  private pi: ExtensionAPI;
  private ctx: ExtensionContext;
  private tui: TUI;
  private theme: Theme;
  private home: string;
  private done: (result: string | undefined) => void;

  private worktrees: WorktreeInfo[];
  private currentReal: string;
  private filtered: WorktreeInfo[] = [];
  private selectedIndex = 0;
  private mode: Mode = "normal";
  private query = "";
  private newName = "";
  private message: { text: string; type: "info" | "warning" | "error" } | null = null;
  private busy = false;
  private maxVisible = 12;

  private topBorder: DynamicBorder;
  private bottomBorder: DynamicBorder;

  constructor(opts: PickerOptions) {
    this.pi = opts.pi;
    this.ctx = opts.ctx;
    this.tui = opts.tui;
    this.theme = opts.theme;
    this.home = opts.home;
    this.done = opts.done;
    this.worktrees = opts.worktrees;
    this.currentReal = realPath(opts.currentPath);
    this.topBorder = new DynamicBorder((s: string) => this.theme.fg("borderAccent", s));
    this.bottomBorder = new DynamicBorder((s: string) => this.theme.fg("borderAccent", s));
    this.updateFilter();
    this.ensureSelected();
  }

  // -- state helpers --

  private isCurrent(wt: WorktreeInfo): boolean {
    return realPath(wt.path) === this.currentReal;
  }

  private updateFilter(): void {
    const q = this.query.toLowerCase();
    this.filtered = q
      ? this.worktrees.filter(
          (w) =>
            (w.branch ?? "(detached)").toLowerCase().includes(q) ||
            w.path.toLowerCase().includes(q),
        )
      : [...this.worktrees];
  }

  private ensureSelected(): void {
    if (this.filtered.length === 0) {
      this.selectedIndex = 0;
      return;
    }
    if (this.selectedIndex >= this.filtered.length) this.selectedIndex = this.filtered.length - 1;
    if (this.selectedIndex < 0) this.selectedIndex = 0;
  }

  private move(delta: number): void {
    if (this.filtered.length === 0) return;
    let i = this.selectedIndex + delta;
    if (i < 0) i = this.filtered.length - 1;
    if (i >= this.filtered.length) i = 0;
    this.selectedIndex = i;
  }

  private selectedWorktree(): WorktreeInfo | null {
    return this.filtered[this.selectedIndex] ?? null;
  }

  private flash(text: string, type: "info" | "warning" | "error" = "info"): void {
    this.message = { text, type };
  }

  private clearMessage(): void {
    this.message = null;
  }

  private requestRender(): void {
    this.tui.requestRender();
  }

  // -- async actions --

  private async refresh(): Promise<void> {
    const list = await listWorktrees(this.pi, this.ctx.cwd);
    if (list) {
      this.worktrees = list;
      this.updateFilter();
      this.ensureSelected();
    }
  }

  private async doCreate(): Promise<void> {
    const name = this.newName.trim();
    if (!name) {
      this.flash("No name given.", "warning");
      this.mode = "normal";
      this.requestRender();
      return;
    }
    this.busy = true;
    this.flash(`Creating worktree "${name}"...`);
    this.requestRender();
    const result = await createWorktree(this.pi, this.ctx.cwd, name);
    this.busy = false;
    if (result.ok) {
      this.flash(`Created worktree "${name}".`, "info");
      this.newName = "";
      this.mode = "normal";
      await this.refresh();
      // Select the freshly created worktree.
      const idx = this.filtered.findIndex((w) => realPath(w.path) === realPath(result.path!));
      if (idx >= 0) this.selectedIndex = idx;
    } else {
      this.flash(result.error ?? "Failed to create worktree.", "error");
      // Stay in newName mode so the user can fix the name.
      this.mode = "newName";
    }
    this.requestRender();
  }

  private async doDelete(): Promise<void> {
    const wt = this.selectedWorktree();
    if (!wt) {
      this.mode = "normal";
      this.requestRender();
      return;
    }
    this.busy = true;
    this.flash(`Deleting worktree "${wt.branch ?? wt.path}"...`);
    this.requestRender();
    const result = await deleteWorktree(this.pi, this.ctx.cwd, wt.path);
    this.busy = false;
    if (result.ok) {
      this.flash(`Deleted worktree "${wt.branch ?? basename(wt.path)}".`, "info");
      await this.refresh();
    } else {
      this.flash(result.error ?? "Failed to delete worktree.", "error");
    }
    this.mode = "normal";
    this.requestRender();
  }

  // -- input --

  handleInput(data: string): void {
    if (this.busy) return;

    if (this.mode === "search") {
      this.handleSearchInput(data);
      this.requestRender();
      return;
    }
    if (this.mode === "newName") {
      this.handleNewNameInput(data);
      this.requestRender();
      return;
    }
    if (this.mode === "confirmDelete") {
      this.handleConfirmDeleteInput(data);
      this.requestRender();
      return;
    }

    // normal mode
    if (matchesKey(data, "j") || matchesKey(data, Key.down)) {
      this.clearMessage();
      this.move(1);
    } else if (matchesKey(data, "k") || matchesKey(data, Key.up)) {
      this.clearMessage();
      this.move(-1);
    } else if (matchesKey(data, "g")) {
      this.clearMessage();
      this.selectedIndex = 0;
      this.ensureSelected();
    } else if (matchesKey(data, Key.shift("g"))) {
      this.clearMessage();
      this.selectedIndex = this.filtered.length - 1;
      this.ensureSelected();
    } else if (matchesKey(data, Key.slash)) {
      this.clearMessage();
      this.mode = "search";
      this.query = "";
    } else if (matchesKey(data, "n")) {
      this.clearMessage();
      this.mode = "newName";
      this.newName = "";
    } else if (matchesKey(data, "d")) {
      this.startDelete();
    } else if (matchesKey(data, Key.enter)) {
      this.switchToSelected();
    } else if (matchesKey(data, "q") || matchesKey(data, Key.escape)) {
      this.done(undefined);
    }

    this.requestRender();
  }

  private startDelete(): void {
    const wt = this.selectedWorktree();
    if (!wt) {
      this.flash("Nothing to delete.", "warning");
      return;
    }
    if (wt.isMain) {
      this.flash("Can't remove the main worktree.", "warning");
      return;
    }
    if (this.isCurrent(wt)) {
      this.flash("Can't remove the worktree you're currently in.", "warning");
      return;
    }
    this.clearMessage();
    this.mode = "confirmDelete";
  }

  private switchToSelected(): void {
    const wt = this.selectedWorktree();
    if (!wt) {
      this.flash("No worktree selected.", "warning");
      return;
    }
    if (this.isCurrent(wt)) {
      this.flash("Already in this worktree.", "info");
      return;
    }
    // Closing the picker first, then the command handler relaunches pi.
    this.done(wt.path);
  }

  private handleSearchInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.mode = "normal";
      this.query = "";
      this.updateFilter();
      this.ensureSelected();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      // Keep the filter applied, return to normal mode to act on results.
      this.mode = "normal";
      this.ensureSelected();
      return;
    }
    if (matchesKey(data, Key.backspace) || matchesKey(data, Key.ctrl("u"))) {
      this.query = matchesKey(data, Key.ctrl("u")) ? "" : this.query.slice(0, -1);
      this.updateFilter();
      this.ensureSelected();
      return;
    }
    const ch = getPrintableChar(data);
    if (ch !== undefined) {
      this.query += ch;
      this.updateFilter();
      this.ensureSelected();
    }
  }

  private handleNewNameInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.mode = "normal";
      this.newName = "";
      this.clearMessage();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      void this.doCreate();
      return;
    }
    if (matchesKey(data, Key.backspace) || matchesKey(data, Key.ctrl("u"))) {
      this.newName = matchesKey(data, Key.ctrl("u")) ? "" : this.newName.slice(0, -1);
      return;
    }
    const ch = getPrintableChar(data);
    if (ch !== undefined) {
      this.newName += ch;
    }
  }

  private handleConfirmDeleteInput(data: string): void {
    // y / d / enter confirm (d mirrors the vim "dd" idiom); anything else cancels.
    if (matchesKey(data, "y") || matchesKey(data, "d") || matchesKey(data, Key.enter)) {
      void this.doDelete();
      return;
    }
    this.mode = "normal";
    this.clearMessage();
  }

  // -- rendering --

  invalidate(): void {
    this.topBorder.invalidate();
    this.bottomBorder.invalidate();
  }

  render(width: number): string[] {
    const lines: string[] = [];
    const theme = this.theme;
    const innerWidth = Math.max(0, width);

    lines.push(...this.topBorder.render(innerWidth));

    // Title
    const title = theme.fg("accent", theme.bold(" Git Worktrees "));
    lines.push(truncateToWidth(title, innerWidth, ""));

    // Subtitle: repo path
    const main = this.worktrees.find((w) => w.isMain) ?? this.worktrees[0];
    if (main) {
      lines.push(truncateToWidth(theme.fg("dim", ` ${abbrevHome(main.path, this.home)}`), innerWidth, ""));
    }
    lines.push("");

    // List
    if (this.filtered.length === 0) {
      lines.push(truncateToWidth(theme.fg("warning", "  No matching worktrees"), innerWidth, ""));
    } else {
      const start = Math.max(0, this.selectedIndex - Math.floor(this.maxVisible / 2));
      const end = Math.min(this.filtered.length, start + this.maxVisible);
      for (let i = start; i < end; i++) {
        lines.push(this.renderWorktreeLine(this.filtered[i]!, i === this.selectedIndex, innerWidth));
      }
      if (start > 0 || end < this.filtered.length) {
        const scroll = `  (${this.selectedIndex + 1}/${this.filtered.length})`;
        lines.push(truncateToWidth(theme.fg("dim", scroll), innerWidth, ""));
      }
    }

    lines.push("");

    // Mode-specific input / message line
    if (this.mode === "search") {
      lines.push(truncateToWidth(theme.fg("accent", ` /${this.query}\u2588`), innerWidth, ""));
    } else if (this.mode === "newName") {
      lines.push(truncateToWidth(theme.fg("accent", ` new: ${this.newName}\u2588`), innerWidth, ""));
    } else if (this.mode === "confirmDelete") {
      const wt = this.selectedWorktree();
      const label = wt?.branch ?? (wt ? basename(wt.path) : "");
      lines.push(
        truncateToWidth(
          theme.fg("warning", ` Delete worktree "${label}"?  y / n`),
          innerWidth,
          "",
        ),
      );
    } else if (this.message) {
      const color = this.message.type === "error" ? "error" : this.message.type === "warning" ? "warning" : "success";
      lines.push(truncateToWidth(theme.fg(color, ` ${this.message.text}`), innerWidth, ""));
    } else {
      lines.push("");
    }

    // Help line
    lines.push(truncateToWidth(theme.fg("dim", ` ${this.helpText()}`), innerWidth, ""));

    lines.push(...this.bottomBorder.render(innerWidth));
    return lines;
  }

  private helpText(): string {
    switch (this.mode) {
      case "search":
        return "type to filter · enter apply · esc clear";
      case "newName":
        return "enter create · esc cancel";
      case "confirmDelete":
        return "y / d delete · n / esc cancel";
      default:
        return "j/k move · / filter · n new · d delete · enter switch · g/G top/bottom · q quit";
    }
  }

  private renderWorktreeLine(wt: WorktreeInfo, selected: boolean, width: number): string {
    const theme = this.theme;
    const current = this.isCurrent(wt);

    // Selection + current markers
    const selPrefix = selected ? theme.fg("accent", "▶ ") : "  ";
    const curPrefix = current
      ? theme.fg("success", "● ")
      : theme.fg("dim", "○ ");

    const branch = wt.branch ?? (wt.bare ? "(bare)" : "(detached)");
    const branchLabel = wt.isMain ? `${branch} (main)` : branch;
    const branchStyled = selected
      ? theme.fg("accent", theme.bold(branchLabel))
      : current
        ? theme.fg("text", branchLabel)
        : theme.fg("muted", branchLabel);

    const left = `${selPrefix}${curPrefix}${branchStyled}`;
    const leftWidth = visibleWidth(left);
    const gap = 2;
    const pathBudget = width - leftWidth - gap;
    const pathRaw = abbrevHome(wt.path, this.home);
    let pathStyled: string;
    if (pathBudget <= 4) {
      pathStyled = "";
    } else {
      const shown = truncatePathLeft(pathRaw, pathBudget);
      pathStyled = theme.fg("dim", shown);
    }

    const line = pathStyled ? `${left}${" ".repeat(gap)}${pathStyled}` : left;
    return truncateToWidth(line, width, "");
  }
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function worktreeExtension(pi: ExtensionAPI) {
  const HOME = process.env.HOME ?? process.env.USERPROFILE ?? "";

  /** Open the picker UI. Returns the path of a worktree to switch to, or undefined. */
  async function openPicker(ctx: ExtensionContext): Promise<string | undefined> {
    if (ctx.mode !== "tui") {
      const list = await listWorktrees(pi, ctx.cwd);
      if (!list) {
        if (ctx.hasUI) ctx.ui.notify("Not a git repository.", "warning");
        return undefined;
      }
      // Non-TUI: just print the worktrees.
      const lines = list.map((w) => `${w.branch ?? "(detached)"}\t${w.path}`);
      if (ctx.hasUI) ctx.ui.notify(lines.join("\n"), "info");
      return undefined;
    }

    const worktrees = await listWorktrees(pi, ctx.cwd);
    if (!worktrees) {
      ctx.ui.notify("Not a git repository.", "warning");
      return undefined;
    }

    return ctx.ui.custom<string | undefined>((tui, theme, _kb, done) => {
      return new WorktreePicker({
        pi,
        ctx,
        tui,
        theme,
        worktrees,
        currentPath: ctx.cwd,
        home: HOME,
        done,
      });
    });
  }

  /** Create a worktree, optionally prompting for the name. */
  async function createWorktreeFlow(ctx: ExtensionContext, name?: string): Promise<void> {
    let branchName = name?.trim();
    if (!branchName) {
      if (!ctx.hasUI) {
        ctx.ui.notify("Usage: /wt new <name>", "warning");
        return;
      }
      branchName = await ctx.ui.input("New worktree", "branch-name");
      if (!branchName?.trim()) {
        ctx.ui.notify("Cancelled.", "info");
        return;
      }
      branchName = branchName.trim();
    }

    ctx.ui.notify(`Creating worktree "${branchName}"...`, "info");
    const result = await createWorktree(pi, ctx.cwd, branchName);
    if (result.ok) {
      ctx.ui.notify(`Created worktree "${branchName}" at ${result.path}`, "info");
    } else {
      ctx.ui.notify(result.error ?? "Failed to create worktree.", "error");
    }
  }

  /** Return to the main (original) project worktree. */
  async function returnToMain(ctx: ExtensionContext): Promise<void> {
    const list = await listWorktrees(pi, ctx.cwd);
    if (!list) {
      if (ctx.hasUI) ctx.ui.notify("Not a git repository.", "warning");
      return;
    }
    const main = list.find((w) => w.isMain) ?? list[0];
    if (!main) {
      if (ctx.hasUI) ctx.ui.notify("Could not determine the main worktree.", "error");
      return;
    }
    const currentReal = realPath(ctx.cwd);
    if (realPath(main.path) === currentReal) {
      if (ctx.hasUI) ctx.ui.notify("Already in the main project.", "info");
      return;
    }
    if (ctx.mode !== "tui") {
      if (ctx.hasUI) ctx.ui.notify(`Main worktree: ${main.path}`, "info");
      return;
    }
    if (ctx.hasUI) ctx.ui.notify(`Returning to ${main.path}`, "info");
    await relaunchPi(main.path, ctx);
  }

  pi.registerCommand("wt", {
    description: "Manage git worktrees (/wt, /wt new [name], /wt return)",
    handler: async (args, ctx) => {
      const trimmed = args?.trim() ?? "";
      const [sub, ...rest] = trimmed.split(/\s+/);
      const nameArg = rest.join(" ").trim();

      if (sub === "new") {
        await createWorktreeFlow(ctx, nameArg || undefined);
        return;
      }
      if (sub === "return") {
        await returnToMain(ctx);
        return;
      }
      if (sub && sub !== "list") {
        ctx.ui.notify(`Unknown /wt argument "${sub}". Usage: /wt | /wt new [name] | /wt return`, "warning");
        return;
      }

      // Default: open the picker.
      const target = await openPicker(ctx);
      if (target) {
        if (ctx.mode !== "tui") {
          if (ctx.hasUI) ctx.ui.notify(`Switch to: ${target}`, "info");
          return;
        }
        if (ctx.hasUI) ctx.ui.notify(`Switching to ${target}`, "info");
        await relaunchPi(target, ctx);
      }
    },
  });
}
