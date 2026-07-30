/**
 * Vim-style quit extension — type ":q" to exit pi gracefully.
 *
 * Supports:
 *   :q   → quit (graceful shutdown)
 *   :q!  → quit immediately (forceful — same as :q, uses shutdown)
 *   :quit → quit (alias)
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const QUIT_COMMANDS = new Set([":q", ":q!", ":quit"]);

export default function (pi: ExtensionAPI) {
	pi.on("input", async (event, ctx) => {
		if (QUIT_COMMANDS.has(event.text.trim())) {
			ctx.ui.notify(event.text.trim(), "info");
			ctx.shutdown();
			return { action: "handled" };
		}
		return { action: "continue" };
	});
}
