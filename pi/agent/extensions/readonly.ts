/**
 * Readonly Mode Extension
 *
 * Toggles a read-only advisory mode. When enabled:
 * - A context message is injected each turn telling the agent to only read
 *   and advise, never to modify anything.
 * - The `edit` and `write` tools are disabled.
 * - Destructive bash commands (writes, deletes, package installs, git state
 *   mutations, editors, sudo, process kills, etc.) are blocked.
 * - A status indicator appears in the footer.
 *
 * Toggle with `/readonly`. Optional argument sets the advisory content that
 * is injected for subsequent turns, e.g.:
 *   /readonly Focus only on the authentication module and recommend fixes.
 * Run `/readonly` again to turn it off.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";

const READONLY_DISABLED_TOOLS = new Set<string>(["edit", "write"]);

const DEFAULT_ADVISORY = `[READONLY MODE ACTIVE]
You are in readonly mode. You may read files and run read-only commands to
investigate and understand the codebase, but you must NOT modify, create, or
delete any files, nor make any other changes to the system.

- The edit and write tools are disabled.
- Destructive shell operations are blocked.

Your job is to advise: explain what you find, diagnose problems, and recommend
concrete next steps to the user. Do not attempt to apply changes yourself.
Describe the exact changes the user should make instead.

When you have finished your analysis, summarize your recommendations clearly.`;

// Patterns that indicate a bash command mutates state. Mirrors the plan-mode
// destructive list plus a broad write-redirect check.
const DESTRUCTIVE_PATTERNS = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bchgrp\b/i,
	/\bln\b/i,
	/\btee\b/i,
	/\btruncate\b/i,
	/\bdd\b/i,
	/\bshred\b/i,
	/(^|[^<])>(?!>)/, // single > redirect
	/>>/, // append redirect
	/\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
	/\byarn\s+(add|remove|install|publish)/i,
	/\bpnpm\s+(add|remove|install|publish)/i,
	/\bpip\s+(install|uninstall)/i,
	/\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
	/\bbrew\s+(install|uninstall|upgrade)/i,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/i,
	/\bsudo\b/i,
	/\bsu\b/i,
	/\bkill\b/i,
	/\bpkill\b/i,
	/\bkillall\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable)/i,
	/\bservice\s+\S+\s+(start|stop|restart)/i,
	/\b(vim?|nano|emacs|code|subl)\b/i,
	/\binstall\b/i,
];

function isDestructiveCommand(command: string): boolean {
	return DESTRUCTIVE_PATTERNS.some((p) => p.test(command));
}

interface ReadonlyState {
	enabled: boolean;
	advisory: string;
	toolsBeforeReadonly?: string[];
}

export default function readonlyExtension(pi: ExtensionAPI): void {
	let enabled = false;
	let advisory = DEFAULT_ADVISORY;
	let toolsBeforeReadonly: string[] | undefined;

	function uniqueToolNames(names: string[]): string[] {
		return [...new Set(names)];
	}

	function enableReadonlyTools(): void {
		if (toolsBeforeReadonly === undefined) {
			toolsBeforeReadonly = pi.getActiveTools();
		}
		pi.setActiveTools(
			uniqueToolNames(toolsBeforeReadonly.filter((name) => !READONLY_DISABLED_TOOLS.has(name))),
		);
	}

	function restoreTools(): void {
		pi.setActiveTools(toolsBeforeReadonly ?? pi.getActiveTools());
		toolsBeforeReadonly = undefined;
	}

	function updateStatus(ctx: ExtensionContext): void {
		if (enabled) {
			ctx.ui.setStatus(
				"readonly",
				ctx.ui.theme.fg("warning", "🔒 readonly"),
			);
		} else {
			ctx.ui.setStatus("readonly", undefined);
		}
	}

	function persistState(): void {
		pi.appendEntry("readonly", {
			enabled,
			advisory,
			toolsBeforeReadonly,
		});
	}

	function toggleReadonly(ctx: ExtensionContext, newAdvisory?: string): void {
		if (!enabled) {
			enabled = true;
			if (newAdvisory !== undefined && newAdvisory.trim().length > 0) {
				advisory = newAdvisory.trim();
			} else {
				advisory = DEFAULT_ADVISORY;
			}
			enableReadonlyTools();
			ctx.ui.notify("Readonly mode enabled. Writes are disabled.", "info");
		} else {
			enabled = false;
			advisory = DEFAULT_ADVISORY;
			restoreTools();
			ctx.ui.notify("Readonly mode disabled. Full access restored.", "info");
		}
		updateStatus(ctx);
		persistState();
	}

	pi.registerFlag("readonly", {
		description: "Start in readonly mode (read-and-advise only)",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("readonly", {
		description: "Toggle readonly mode (read and advise, no writes)",
		handler: async (args, ctx) => {
			toggleReadonly(ctx, args || undefined);
		},
	});

	pi.registerShortcut(Key.ctrlAlt("r"), {
		description: "Toggle readonly mode",
		handler: async (ctx) => toggleReadonly(ctx),
	});

	// Inject the advisory context every turn while readonly is active.
	pi.on("before_agent_start", async () => {
		if (!enabled) return;
		return {
			message: {
				customType: "readonly-context",
				content: advisory,
				display: false,
			},
		};
	});

	// Filter out stale readonly context messages when readonly is off, so they
	// don't linger in the conversation after the mode is disabled.
	pi.on("context", async (event) => {
		if (enabled) return;
		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				return msg.customType !== "readonly-context";
			}),
		};
	});

	// Block destructive bash commands while readonly is active.
	pi.on("tool_call", async (event) => {
		if (!enabled || event.toolName !== "bash") return;
		const command = (event.input as { command?: string }).command ?? "";
		if (isDestructiveCommand(command)) {
			return {
				block: true,
				reason: `Readonly mode active: this command appears to modify state and is blocked. Use /readonly to disable readonly mode first.\nCommand: ${command}`,
			};
		}
	});

	// Restore persisted state on session start / resume.
	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("readonly") === true) {
			enabled = true;
		}

		const entries = ctx.sessionManager.getEntries();
		const persisted = entries
			.filter(
				(e: { type: string; customType?: string }) =>
					e.type === "custom" && e.customType === "readonly",
			)
			.pop() as { data?: ReadonlyState } | undefined;

		if (persisted?.data) {
			enabled = persisted.data.enabled ?? enabled;
			advisory = persisted.data.advisory ?? DEFAULT_ADVISORY;
			toolsBeforeReadonly = persisted.data.toolsBeforeReadonly ?? toolsBeforeReadonly;
		}

		if (enabled) {
			enableReadonlyTools();
		}
		updateStatus(ctx);
	});

	// Clean up on shutdown.
	pi.on("session_shutdown", async () => {
		enabled = false;
		toolsBeforeReadonly = undefined;
	});
}

// Re-exported so other extensions can type-check readonly context messages.
export type { ReadonlyState };
