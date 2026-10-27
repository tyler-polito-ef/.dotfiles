/**
 * Permission Gate Extension
 *
 * Runs every bash command through TypeSafe's Jev classifier (via Vercel AI Gateway)
 * and asks for confirmation only when the command would:
 *   - mutate an upstream/remote repository (git push, gh pr create, gh api -X DELETE, ...)
 *   - permanently delete files or data on this machine (rm, find -delete, git clean, ...)
 * Everything else runs without a prompt.
 *
 * If the classifier is unavailable (offline, auth error, ...) it falls back to a small
 * set of regexes covering the same two categories.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "vercel-ai-gateway";
const MODEL_ID = "typesafe-ai/jev-1.14.0";
/** Probability at or above which a category triggers the gate. */
const THRESHOLD = 0.5;

const QUESTIONS = {
  upstream: {
    type: "bool",
    instructions:
      "Would running `command` in a shell change state on a remote/upstream repository or hosting service (e.g. git push, merging or closing PRs, creating/deleting releases, branches, issues, secrets on GitHub/GitLab, or write calls to their APIs)? Reading, listing, viewing, fetching, pulling, cloning, and local-only git operations (commit, branch, checkout, rebase, stash) do NOT count.",
    criteria: {
      true: "Mutates remote/upstream repository state",
      false: "Read-only toward remotes, or local-only",
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

/** Used only when the classifier can't be reached. */
const FALLBACK_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "upstream", re: /(^|[;&|]\s*|\$\(\s*)(?:[A-Za-z_]\w*=\S*\s+)*git\s+[^;&|]*\bpush\b/im },
  {
    label: "upstream",
    re: /(^|[;&|]\s*|\$\(\s*)(?:[A-Za-z_]\w*=\S*\s+)*gh\s+(?:[^;&|]*\b(create|delete|edit|merge|close|reopen|rename|fork|ready|upload)\b|\bapi\b[^;&|]*(\bmutation\b|-f\b|-F\b|--field|--raw-field|--input|(-X|--method)\s*(POST|PUT|PATCH|DELETE)))/im,
  },
  { label: "deletes", re: /(^|[;&|]\s*|\$\(\s*)(?:sudo\s+)?(rm|rmdir|shred|unlink)\b/im },
  { label: "deletes", re: /\bfind\b[^;&|]*-delete\b/i },
  { label: "deletes", re: /\bgit\s+[^;&|]*\b(clean\s+-\w*f|reset\s+--hard)/i },
];

type Verdict = { flagged: string[]; detail: string };

export default function (pi: ExtensionAPI) {
  const cache = new Map<string, Verdict>();

  function fallback(command: string, why: string): Verdict {
    const flagged = [...new Set(FALLBACK_PATTERNS.filter((p) => p.re.test(command)).map((p) => p.label))];
    return { flagged, detail: `regex fallback — ${why}` };
  }

  async function classify(command: string, cwd: string, ctx: any): Promise<Verdict> {
    const cached = cache.get(command);
    if (cached) return cached;

    const jev = ctx.modelRegistry.getModelOfType("classifier", PROVIDER, MODEL_ID);
    if (!jev) return fallback(command, `${PROVIDER}/${MODEL_ID} not found`);

    const result = await ctx.modelRegistry.classify(
      jev,
      { state: { command, cwd }, questions: QUESTIONS },
      { signal: ctx.signal },
    );
    if (result.stopReason !== "stop") {
      return fallback(command, result.errorMessage ?? result.stopReason);
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
    cache.set(command, verdict);
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
