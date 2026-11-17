/**
 * Permission Gate Extension
 *
 * Runs every bash command through TypeSafe's Jev classifier (via Vercel AI Gateway)
 * and asks for confirmation only when the command would:
 *   - mutate an upstream/remote repository (git push to main/master, gh pr create, gh api -X DELETE, ...)
 *   - permanently delete files or data on this machine (rm, find -delete, git clean, ...)
 * Pushing to branches other than main/master (including force-pushing a feature branch) is allowed.
 * Everything else runs without a prompt.
 *
 * If the classifier is unavailable (offline, auth error, ...) it falls back to a small
 * set of regexes covering the same two categories.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Branches that pushes are gated for. */
const PROTECTED_BRANCHES = ["main", "master"];

const PROVIDER = "vercel-ai-gateway";
const MODEL_ID = "typesafe-ai/jev-1.14.0";
/** Probability at or above which a category triggers the gate. */
const THRESHOLD = 0.5;

const QUESTIONS = {
  upstream: {
    type: "bool",
    instructions:
      "Would running `command` in a shell change state on a remote/upstream repository or hosting service in a way that is NOT just pushing commits to a non-protected branch? `protectedBranches` lists the protected branches and `currentBranch` is the branch checked out in `cwd` (null if unknown). COUNTS: git push that updates a protected branch (explicit refspec like `origin main` or `HEAD:main`, or a bare `git push` / `git push origin` / `git push origin HEAD` while `currentBranch` is protected or null), git push --all/--mirror/--tags or pushing tags, deleting remote branches (`--delete`, `:branch`), merging or closing PRs, creating/deleting releases, branches, issues, secrets on GitHub/GitLab, or write calls to their APIs. Does NOT count: git push (including --force, -u, --set-upstream) of any branch that is not protected, e.g. `git push -u origin feature/x` or a bare `git push` while `currentBranch` is not protected; reading, listing, viewing, fetching, pulling, cloning; and local-only git operations (commit, branch, checkout, rebase, stash).",
    criteria: {
      true: "Mutates remote/upstream state beyond pushing a non-protected branch",
      false: "Read-only toward remotes, local-only, or only pushes non-protected branches",
    },
  },
  deletes: {
    type: "bool",
    instructions:
      "Would running `command` permanently delete or irrecoverably destroy files or data on the local machine (e.g. rm, rm -rf, find -delete, shred, truncating/overwriting existing files with >, git clean -fdx, git reset --hard discarding uncommitted work, dd to a disk)? Moving files to trash, deleting temp files the command itself just created, and creating/overwriting new build output do NOT count.",
    criteria: {
      true: "Permanently deletes or destroys local files/data",
      false: "No permanent local deletion",
    },
  },
} as const;

const isProtected = (ref: string | null | undefined) =>
  ref == null || PROTECTED_BRANCHES.includes(ref.replace(/^refs\/heads\//, ""));

/**
 * Regex-fallback check for `git push`: true unless every push in the command only
 * targets non-protected branches.
 */
function pushIsRisky(command: string, currentBranch: string | null): boolean {
  const segments = command.split(/&&|\|\||[;&|\n]|\$\(/);
  for (const segment of segments) {
    const m = segment.match(/^\s*(?:[A-Za-z_]\w*=\S*\s+)*git\s+(.*)$/s);
    if (!m) continue;
    const tokens = m[1].trim().split(/\s+/).filter(Boolean);
    const pushIdx = tokens.indexOf("push");
    if (pushIdx === -1) continue;

    const args = tokens.slice(pushIdx + 1);
    const positional: string[] = [];
    for (const arg of args) {
      if (/^(--all|--mirror|--tags|--follow-tags|--delete|-d|--prune)$/.test(arg)) return true;
      if (arg === "--repo" || arg.startsWith("--repo=")) return true; // unusual; be safe
      if (arg.startsWith("-")) continue; // --force, -u, --set-upstream, --force-with-lease, ...
      positional.push(arg.replace(/^["']|["']$/g, ""));
    }

    const refspecs = positional.slice(1); // first positional is the remote
    if (refspecs.length === 0) {
      if (isProtected(currentBranch)) return true;
      continue;
    }
    for (const spec of refspecs) {
      const [src, dst] = spec.replace(/^\+/, "").split(":", 2);
      if (dst !== undefined && src === "") return true; // `:branch` deletes it
      if (spec.startsWith("refs/tags/") || /^v?\d+\.\d+/.test(src)) return true; // tags
      let target = dst ?? src;
      if (target === "HEAD" || target === "@") target = currentBranch ?? "";
      if (target === "" || isProtected(target)) return true;
    }
  }
  return false;
}

/** Used only when the classifier can't be reached. */
const FALLBACK_PATTERNS: { label: string; test: (command: string, currentBranch: string | null) => boolean }[] = [
  { label: "upstream", test: pushIsRisky },
  {
    label: "upstream",
    test: (c) => /(^|[;&|]\s*|\$\(\s*)(?:[A-Za-z_]\w*=\S*\s+)*gh\s+(?:[^;&|]*\b(create|delete|edit|merge|close|reopen|rename|fork|ready|upload)\b|\bapi\b[^;&|]*(\bmutation\b|-f\b|-F\b|--field|--raw-field|--input|(-X|--method)\s*(POST|PUT|PATCH|DELETE)))/im.test(c),
  },
  { label: "deletes", test: (c) => /(^|[;&|]\s*|\$\(\s*)(?:sudo\s+)?(rm|rmdir|shred|unlink)\b/im.test(c) },
  { label: "deletes", test: (c) => /\bfind\b[^;&|]*-delete\b/i.test(c) },
  { label: "deletes", test: (c) => /\bgit\s+[^;&|]*\b(clean\s+-\w*f|reset\s+--hard)/i.test(c) },
];

type Verdict = { flagged: string[]; detail: string };

export default function (pi: ExtensionAPI) {
  const cache = new Map<string, Verdict>();

  async function getCurrentBranch(cwd: string, signal?: AbortSignal): Promise<string | null> {
    try {
      const r = await pi.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, signal, timeout: 2000 });
      const branch = r.stdout.trim();
      return r.code === 0 && branch && branch !== "HEAD" ? branch : null;
    } catch {
      return null;
    }
  }

  function fallback(command: string, currentBranch: string | null, why: string): Verdict {
    const flagged = [
      ...new Set(FALLBACK_PATTERNS.filter((p) => p.test(command, currentBranch)).map((p) => p.label)),
    ];
    return { flagged, detail: `regex fallback — ${why}` };
  }

  async function classify(command: string, cwd: string, ctx: any): Promise<Verdict> {
    // Only look up the branch when it can matter.
    const currentBranch = /\bpush\b/.test(command) ? await getCurrentBranch(cwd, ctx.signal) : null;
    const cacheKey = `${currentBranch ?? ""}\0${command}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const jev = ctx.modelRegistry.getModelOfType("classifier", PROVIDER, MODEL_ID);
    if (!jev) return fallback(command, currentBranch, `${PROVIDER}/${MODEL_ID} not found`);

    const result = await ctx.modelRegistry.classify(
      jev,
      {
        state: { command, cwd, currentBranch, protectedBranches: PROTECTED_BRANCHES },
        questions: QUESTIONS,
      },
      { signal: ctx.signal },
    );
    if (result.stopReason !== "stop") {
      return fallback(command, currentBranch, result.errorMessage ?? result.stopReason);
    }

    const probs: Record<string, number> = {};
    for (const key of Object.keys(QUESTIONS)) {
      const a = result.answers[key];
      probs[key] = a?.type === "bool" ? a.probability : 1; // missing answer → treat as risky
    }
    const verdict: Verdict = {
      flagged: Object.keys(probs).filter((k) => probs[k] >= THRESHOLD),
      detail: Object.entries(probs)
        .map(([k, p]) => `${k} ${p.toFixed(2)}`)
        .join(", "),
    };
    cache.set(cacheKey, verdict);
    return verdict;
  }

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return undefined;

    const command = event.input.command as string;
    const { flagged, detail } = await classify(command, ctx.cwd, ctx);
    if (flagged.length === 0) return undefined;

    const what = flagged
      .map((f) => (f === "upstream" ? "mutates an upstream repo" : "permanently deletes local files"))
      .join(" + ");

    if (!ctx.hasUI) {
      return { block: true, reason: `Command ${what} (${detail}); blocked with no UI for confirmation` };
    }

    const choice = await ctx.ui.select(
      `⚠️ Command ${what}  [${detail}]\n\n  ${command}\n\nAllow?`,
      ["Yes", "No"],
    );
    if (choice !== "Yes") return { block: true, reason: "Blocked by user" };
    return undefined;
  });
}
