/**
 * save-md Extension
 *
 * Saves the latest assistant response on the active session branch as a
 * Markdown file relative to Pi's current working directory.
 *
 * Usage:
 *   /save-md name        -> writes name.md
 *   /save-md name.md     -> writes name.md (suffix optional)
 *
 * Only assistant text is preserved. Thinking blocks and tool-call blocks are
 * excluded. Existing files are never overwritten.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

type ContentBlock = {
  type?: string;
  text?: string;
};

type SessionEntry = {
  type: string;
  message?: {
    role?: string;
    content?: unknown;
  };
};

/**
 * Extract only assistant text blocks from a message's content, excluding
 * thinking and tool-call blocks.
 */
const extractAssistantText = (content: unknown): string => {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const textParts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") {
      continue;
    }

    const block = part as ContentBlock;
    if (block.type === "text" && typeof block.text === "string") {
      textParts.push(block.text);
    }
  }

  return textParts.join("\n\n");
};

/**
 * Find the latest assistant message entry on the active session branch and
 * return its concatenated text content.
 *
 * `getBranch()` returns entries in chronological (root -> leaf) order, so we
 * iterate from the end to find the most recent assistant message.
 */
const findLatestAssistantText = (branch: SessionEntry[]): string => {
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type === "message" && entry.message?.role === "assistant") {
      return extractAssistantText(entry.message.content).trim();
    }
  }
  return "";
};

export default function (pi: ExtensionAPI) {
  pi.registerCommand("save-md", {
    description:
      "Save the latest assistant response as Markdown (usage: /save-md name)",
    handler: async (args, ctx) => {
      const name = args.trim();

      if (!name) {
        if (ctx.hasUI) {
          ctx.ui.notify("Usage: /save-md <name>", "warning");
        }
        return;
      }

      // .md suffix is optional; normalize the filename.
      const fileName = name.toLowerCase().endsWith(".md") ? name : `${name}.md`;
      const filePath = resolve(join(ctx.cwd, fileName));

      // Refuse to overwrite existing files.
      try {
        await access(filePath);
        if (ctx.hasUI) {
          ctx.ui.notify(
            `Already exists: ${filePath} (not overwritten)`,
            "error",
          );
        }
        return;
      } catch {
        // File does not exist — proceed.
      }

      // Find the latest assistant response on the active session branch.
      const branch = ctx.sessionManager.getBranch();
      const text = findLatestAssistantText(branch);

      if (!text) {
        if (ctx.hasUI) {
          ctx.ui.notify(
            "No assistant text found on the active branch",
            "warning",
          );
        }
        return;
      }

      // Write the file, creating any missing parent directories.
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, `${text}\n`, "utf8");

      if (ctx.hasUI) {
        ctx.ui.notify(`Saved: ${filePath}`, "info");
      }
    },
  });
}
