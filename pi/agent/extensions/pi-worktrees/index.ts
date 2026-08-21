/**
 * pi-worktrees — sync pi with herdr's worktree state.
 *
 * Slash command:
 *   /wt                       Show usage
 *   /wt new [branch]          Create + open a herdr git worktree
 *      [--base REF] [--label TEXT] [--focus|--no-focus]
 *   /wt list                  List herdr worktrees (select one to open)
 *   /wt delete [workspace_id] Remove a worktree workspace (pick if omitted)
 *      [--force]
 *
 * All operations shell out to the `herdr` CLI, which talks to the running
 * herdr server over its socket. Output is JSON; we parse it so the UI stays
 * structured. Listing reads live herdr state, so `/wt list` always reflects
 * the current worktree set — including worktrees created outside pi.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

// --- herdr API types (subset we use) -------------------------------------

interface WorktreeInfo {
  branch: string | null;
  is_bare: boolean;
  is_detached: boolean;
  is_linked_worktree: boolean;
  is_prunable: boolean;
  label: string;
  open_workspace_id: string | null;
  path: string;
}

interface WorkspaceInfo {
  workspace_id: string;
  label: string;
  number: number;
}

interface WorktreeListResult {
  type: "worktree_list";
  source: {
    repo_key: string;
    repo_name: string;
    repo_root: string;
    source_checkout_path: string;
    source_workspace_id: string | null;
  };
  worktrees: WorktreeInfo[];
}

interface WorktreeCreateResult {
  type: "worktree_created";
  workspace: WorkspaceInfo;
  worktree: WorktreeInfo;
}

interface WorktreeRemoveResult {
  type: "worktree_removed";
  workspace_id: string;
  workspace: WorkspaceInfo | null;
  worktree: WorktreeInfo;
  forced: boolean;
}

type HerdrResult =
  | { ok: true; result: unknown }
  | { ok: false; message: string; code?: string };

// --- helpers -------------------------------------------------------------

/** Run `herdr` and parse its JSON envelope. */
async function runHerdr(
  pi: ExtensionAPI,
  args: string[],
  signal?: AbortSignal,
): Promise<HerdrResult> {
  try {
    const res = await pi.exec("herdr", args, { signal, timeout: 30_000 });
    const out = (res.stdout ?? "").trim();

    if (res.code !== 0 && !out) {
      const err = (res.stderr ?? "").trim();
      return {
        ok: false,
        message: err || `herdr exited with code ${res.code}`,
      };
    }

    if (!out) {
      return { ok: false, message: "herdr produced no output" };
    }

    let parsed: { error?: { code?: string; message?: string }; result?: unknown };
    try {
      parsed = JSON.parse(out);
    } catch {
      // Not JSON — surface the raw text (likely a human-readable error).
      return { ok: false, message: out };
    }

    if (parsed.error) {
      return {
        ok: false,
        message: parsed.error.message ?? JSON.stringify(parsed.error),
        code: parsed.error.code,
      };
    }
    if (parsed.result) {
      return { ok: true, result: parsed.result };
    }
    return { ok: false, message: out };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: msg };
  }
}

/** Split a command arg string, honoring "..." and '...' quotes. */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return tokens;
}

/** Shorten a path for display: ~/Workspace/repo -> repo when under home. */
function shortPath(p: string): string {
  const home = process.env.HOME;
  if (home && (p === home || p.startsWith(home + "/"))) {
    return "~" + p.slice(home.length);
  }
  return p;
}

const SUBCOMMANDS = ["new", "list", "delete", "help"] as const;
const USAGE =
  "/wt new [branch] [--base REF] [--label TEXT] [--focus] · /wt list · /wt delete [id] [--force]";

// --- subcommands ---------------------------------------------------------

async function wtNew(
  pi: ExtensionAPI,
  rest: string[],
  ctx: ExtensionCommandContext,
): Promise<void> {
  let branch: string | undefined;
  let base: string | undefined;
  let label: string | undefined;
  let focus = false;

  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t === "--base") base = rest[++i];
    else if (t === "--label") label = rest[++i];
    else if (t === "--focus") focus = true;
    else if (t === "--no-focus") focus = false;
    else if (t.startsWith("--")) continue; // ignore unknown flags
    else if (!branch) branch = t;
  }

  if (!branch) {
    branch = await ctx.ui.input("New worktree branch:", "feature/my-thing");
    if (!branch) {
      ctx.ui.notify("Cancelled.", "info");
      return;
    }
  }

  const args = [
    "worktree",
    "create",
    "--cwd",
    ctx.cwd,
    "--branch",
    branch,
    focus ? "--focus" : "--no-focus",
  ];
  if (base) args.push("--base", base);
  if (label) args.push("--label", label);

  ctx.ui.setStatus("herdr-wt", `Creating worktree ${branch}…`);
  const res = await runHerdr(pi, args, ctx.signal);
  ctx.ui.setStatus("herdr-wt", undefined);

  if (!res.ok) {
    ctx.ui.notify(`Failed to create worktree: ${res.message}`, "error");
    return;
  }

  const result = res.result as WorktreeCreateResult;
  const wt = result.worktree;
  const ws = result.workspace;
  ctx.ui.notify(
    `Created worktree${ws ? ` · workspace ${ws.label}` : ""}\n` +
      `  branch: ${wt.branch ?? branch}\n` +
      `  path:   ${shortPath(wt.path)}`,
    "info",
  );
}

async function wtList(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const res = await runHerdr(
    pi,
    ["worktree", "list", "--cwd", ctx.cwd],
    ctx.signal,
  );
  if (!res.ok) {
    ctx.ui.notify(`Failed to list worktrees: ${res.message}`, "error");
    return;
  }

  const { worktrees } = res.result as WorktreeListResult;
  if (worktrees.length === 0) {
    ctx.ui.notify("No worktrees found for this repo.", "info");
    return;
  }

  const items = worktrees.map((w) => {
    const tag = w.is_linked_worktree ? "" : " (main)";
    const ws = w.open_workspace_id ? ` [${w.open_workspace_id}]` : "";
    const prunable = w.is_prunable ? " · prunable" : "";
    return (
      `${w.label}${tag}${ws} · branch=${w.branch ?? "-"}${prunable}\n` +
      `  ${shortPath(w.path)}`
    );
  });

  const choice = await ctx.ui.select("Herdr worktrees (enter to open)", items);
  if (!choice) return;
  const idx = items.indexOf(choice);
  if (idx < 0) return;

  const w = worktrees[idx];
  const open = await ctx.ui.confirm(
    "Open worktree in herdr?",
    `${w.label} · ${w.branch ?? shortPath(w.path)}`,
  );
  if (!open) return;

  const openArgs = ["worktree", "open", "--cwd", ctx.cwd, "--focus"];
  if (w.branch) openArgs.push("--branch", w.branch);
  else openArgs.push("--path", w.path);

  const r = await runHerdr(pi, openArgs, ctx.signal);
  if (!r.ok) {
    ctx.ui.notify(`Failed to open worktree: ${r.message}`, "error");
    return;
  }
  ctx.ui.notify(`Opened ${w.label}.`, "info");
}

async function wtDelete(
  pi: ExtensionAPI,
  rest: string[],
  ctx: ExtensionCommandContext,
): Promise<void> {
  let workspaceId: string | undefined;
  let force = false;

  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t === "--force") force = true;
    else if (t.startsWith("--")) continue;
    else if (!workspaceId) workspaceId = t;
  }

  if (!workspaceId) {
    const res = await runHerdr(
      pi,
      ["worktree", "list", "--cwd", ctx.cwd],
      ctx.signal,
    );
    if (!res.ok) {
      ctx.ui.notify(`Failed to list worktrees: ${res.message}`, "error");
      return;
    }
    const { worktrees } = res.result as WorktreeListResult;
    // Only offer worktrees that herdr currently has open as workspaces —
    // `remove` needs a workspace id, and removing the main checkout is
    // almost never what you want.
    const pickable = worktrees.filter(
      (w) => w.is_linked_worktree && w.open_workspace_id,
    );
    if (pickable.length === 0) {
      ctx.ui.notify(
        "No open linked worktrees to delete. (The main checkout can't be removed here.)",
        "info",
      );
      return;
    }

    const items = pickable.map(
      (w) =>
        `${w.label} [${w.open_workspace_id}] · branch=${w.branch ?? "-"}\n` +
        `  ${shortPath(w.path)}`,
    );
    const choice = await ctx.ui.select("Delete worktree", items);
    if (!choice) return;
    const idx = items.indexOf(choice);
    if (idx < 0) return;
    workspaceId = pickable[idx].open_workspace_id!;
  }

  const confirmed = await ctx.ui.confirm(
    "Remove worktree?",
    `workspace ${workspaceId}${force ? " (force)" : ""}\n` +
      `This removes the herdr workspace and its worktree checkout.`,
  );
  if (!confirmed) return;

  const args = ["worktree", "remove", "--workspace", workspaceId];
  if (force) args.push("--force");

  const res = await runHerdr(pi, args, ctx.signal);
  if (!res.ok) {
    ctx.ui.notify(`Failed to remove worktree: ${res.message}`, "error");
    return;
  }

  const result = res.result as WorktreeRemoveResult;
  ctx.ui.notify(
    `Removed ${result.worktree.label}${result.forced ? " (forced)" : ""}.`,
    "info",
  );
}

// --- extension entry -----------------------------------------------------

export default function worktreesExtension(pi: ExtensionAPI): void {
  pi.registerCommand("wt", {
    description: "Manage herdr git worktrees: new | list | delete",
    getArgumentCompletions(prefix: string): AutocompleteItem[] | null {
      const items = SUBCOMMANDS.map((s) => ({ value: s, label: s }));
      const filtered = items.filter((i) => i.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const tokens = tokenize(args.trim());
      const sub = (tokens[0] ?? "").toLowerCase();
      const rest = tokens.slice(1);

      switch (sub) {
        case "":
        case "help":
          ctx.ui.notify(USAGE, "info");
          return;
        case "new":
          await wtNew(pi, rest, ctx);
          return;
        case "list":
          await wtList(pi, ctx);
          return;
        case "delete":
          await wtDelete(pi, rest, ctx);
          return;
        default:
          ctx.ui.notify(
            `Unknown /wt subcommand: ${sub}. Try: new, list, delete`,
            "error",
          );
      }
    },
  });
}
