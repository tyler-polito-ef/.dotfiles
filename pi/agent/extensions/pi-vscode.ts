/**
 * Pi-VSCode — bridges the "Pi Selection Broadcaster" VS Code extension into pi.
 *
 * Connects to the broadcaster's WebSocket server and renders a compact,
 * right-aligned widget above the chat input showing:
 *   - the currently open file (top right), with cursor position when idle
 *   - the selected text + line range when a non-empty selection exists
 *
 * Connection URL defaults to ws://127.0.0.1:7357. Override with the
 * PI_VSCODE_WS_URL environment variable (e.g. if you changed the port in
 * VS Code settings under piSelectionBroadcaster.port / .host).
 *
 * The socket reconnects with exponential backoff if the extension stops or
 * restarts.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

interface SelectionPayload {
  type: "selectionChanged" | "activeEditorChanged";
  timestamp: string;
  file: {
    uri: string;
    path?: string;
    languageId: string;
  };
  kind?: string;
  selections?: Array<{
    isEmpty: boolean;
    isReversed: boolean;
    anchor: { line: number; character: number };
    active: { line: number; character: number };
    start: { line: number; character: number };
    end: { line: number; character: number };
    text: string;
  }>;
}

const WS_URL = process.env.PI_VSCODE_WS_URL || "ws://127.0.0.1:7357";
const WIDGET_ID = "pi-vscode";

interface SocketHandle {
  close: () => void;
}

interface SocketHandlers {
  onOpen?: () => void;
  onMessage?: (data: string) => void;
  onClose?: () => void;
  onError?: () => void;
}

/**
 * Open a WebSocket. Prefers the global WebSocket (Node 22+ / undici, standard
 * EventTarget API), falls back to the `ws` package (EventEmitter API) if the
 * global is unavailable. Returns null if neither is available.
 */
function openSocket(url: string, h: SocketHandlers): SocketHandle | null {
  type AnyWebSocket = {
    new (url: string): any;
    prototype: { addEventListener?: (...args: any[]) => void };
  };
  const G = (globalThis as { WebSocket?: AnyWebSocket }).WebSocket;

  if (G && typeof G.prototype?.addEventListener === "function") {
    const s = new G(url);
    s.addEventListener("open", () => h.onOpen?.());
    s.addEventListener("message", (e: { data: unknown }) => {
      const d =
        typeof e.data === "string"
          ? e.data
          : typeof (e.data as { toString?: () => string })?.toString === "function"
            ? (e.data as { toString: () => string }).toString()
            : "";
      h.onMessage?.(d);
    });
    s.addEventListener("close", () => h.onClose?.());
    s.addEventListener("error", () => h.onError?.());
    return { close: () => safeClose(s) };
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const WsMod = require("ws");
    const Ws = WsMod.WebSocket ?? WsMod;
    const s = new Ws(url);
    if (typeof s.addEventListener === "function") {
      s.addEventListener("open", () => h.onOpen?.());
      s.addEventListener("message", (e: { data: { toString: () => string } }) =>
        h.onMessage?.(e.data?.toString?.() ?? ""),
      );
      s.addEventListener("close", () => h.onClose?.());
      s.addEventListener("error", () => h.onError?.());
    } else {
      s.on("open", () => h.onOpen?.());
      s.on("message", (data: { toString: () => string }) => h.onMessage?.(data?.toString?.() ?? ""));
      s.on("close", () => h.onClose?.());
      s.on("error", () => h.onError?.());
    }
    return { close: () => safeClose(s) };
  } catch {
    return null;
  }
}

function safeClose(s: { close?: () => void }): void {
  try {
    s.close?.();
  } catch {
    // ignore
  }
}

/** Right-align a (possibly ANSI-styled) string within `width` columns. */
function rightAlign(line: string, width: number): string {
  const w = visibleWidth(line);
  if (w >= width) return truncateToWidth(line, width, "");
  return " ".repeat(width - w) + line;
}

/** Return just the file name from a path or URI. */
function basename(p: string): string {
  const clean = p.split("?")[0]!.split("#")[0]!;
  const idx = clean.lastIndexOf("/");
  const base = idx >= 0 ? clean.slice(idx + 1) : clean;
  return base || clean;
}

export default function piVscodeExtension(pi: ExtensionAPI): void {
  let latest: SelectionPayload | null = null;
  let connected = false;
  let socket: SocketHandle | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let tuiRef: { requestRender(): void } | null = null;

  function scheduleReconnect(): void {
    if (reconnectTimer) return;
    const delay = Math.min(1000 * 2 ** reconnectAttempt, 30000);
    reconnectAttempt++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function connect(): void {
    if (socket) return; // idempotent
    const handle = openSocket(WS_URL, {
      onOpen: () => {
        connected = true;
        reconnectAttempt = 0;
        requestRender();
      },
      onMessage: (data) => {
        try {
          latest = JSON.parse(data) as SelectionPayload;
          requestRender();
        } catch {
          // ignore malformed payloads
        }
      },
      onClose: () => {
        connected = false;
        socket = null;
        requestRender();
        scheduleReconnect();
      },
      onError: () => {
        // close handler will reconnect
      },
    });

    if (!handle) {
      // No WebSocket implementation available — retry later in case it changes.
      scheduleReconnect();
      return;
    }
    socket = handle;
  }

  function disconnect(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (socket) {
      socket.close();
      socket = null;
    }
    connected = false;
  }

  function requestRender(): void {
    tuiRef?.requestRender();
  }

  function renderWidget(theme: any, width: number): string[] {
    const w = width > 0 ? width : 80;

    if (!latest) {
      if (!connected) {
        return [rightAlign(theme.fg("dim", " vscode ◌ no connection"), w)];
      }
      return [];
    }

    const name = basename(latest.file.path ?? latest.file.uri);
    const selections = latest.selections ?? [];
    const primary = selections[0];
    const hasSelection = !!primary && !primary.isEmpty;

    // Line numbers: "L24:6->28:12" for a selection, "L24:6" for a bare cursor,
    // "3 selections" when multi-cursor.
    let info = "";
    if (selections.length > 1) {
      info = `${selections.length} selections`;
    } else if (hasSelection) {
      info = `L${primary!.start.line + 1}:${primary!.start.character + 1}->${primary!.end.line + 1}:${primary!.end.character + 1}`;
    } else if (primary) {
      info = `L${primary.active.line + 1}:${primary.active.character + 1}`;
    }

    let line = theme.fg("text", name);
    if (info) line += theme.fg("dim", "  " + info);
    return [rightAlign(line, w)];
  }

  /*
   * Tool: get_editor_selection
   *
   * Lets the agent ask "what file is the user in / what did they select?" on
   * demand, returning the absolute path, language, selection ranges, and the
   * selected text. On-demand keeps context lean (no per-turn cost).
   *
   * ALTERNATIVE (if you'd rather the agent always know without calling a
   * tool): inject the selection into context every turn via a
   * `before_agent_start` handler that returns:
   *   { message: { customType: "editor-context", content: <summary>, display: false } }
   * That keeps the agent constantly aware but spends tokens each turn.
   */
  pi.registerTool({
    name: "get_editor_selection",
    label: "Editor Selection",
    description:
      "Return the user's current VS Code editor state: the active file (absolute path + language) and the current selection(s) with line/column ranges and selected text. Use to answer 'what file am I in' or 'what did I just select' without asking the user to paste code. Requires the Pi Selection Broadcaster VS Code extension to be running.",
    parameters: Type.Object({
      includeText: Type.Optional(
        Type.Boolean({
          description: "If true (default), include the selected text for non-empty selections. Set false to get just the file and ranges.",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!latest) {
        return {
          content: [
            {
              type: "text",
              text: connected
                ? "No editor state received yet."
                : "Not connected to VS Code (Pi Selection Broadcaster not running on " + WS_URL + ").",
            },
          ],
          details: { connected, hasState: false },
        };
      }

      const file = latest.file;
      const selections = latest.selections ?? [];
      const wantText = params.includeText !== false;

      const lines: string[] = [];
      lines.push(`File: ${file.path ?? file.uri}`);
      lines.push(`Language: ${file.languageId}`);
      lines.push(`URI: ${file.uri}`);

      if (selections.length === 0) {
        lines.push("Selection: (none reported)");
      } else if (selections.length === 1) {
        const s = selections[0]!;
        if (s.isEmpty) {
          lines.push(`Cursor: L${s.active.line + 1}:${s.active.character + 1}`);
        } else {
          lines.push(
            `Selection: L${s.start.line + 1}:${s.start.character + 1} -> L${s.end.line + 1}:${s.end.character + 1}`,
          );
          if (wantText) {
            lines.push("");
            lines.push(s.text);
          }
        }
      } else {
        lines.push(`Multi-cursor: ${selections.length} selections`);
        selections.forEach((s, i) => {
          if (s.isEmpty) {
            lines.push(`[${i + 1}] Cursor: L${s.active.line + 1}:${s.active.character + 1}`);
          } else {
            lines.push(
              `[${i + 1}] Selection: L${s.start.line + 1}:${s.start.character + 1} -> L${s.end.line + 1}:${s.end.character + 1}`,
            );
            if (wantText) {
              lines.push("");
              lines.push(s.text);
            }
          }
        });
      }

      // Soft-cap so a pathological selection can't dump a huge blob.
      const MAX = 10000;
      let text = lines.join("\n");
      if (text.length > MAX) {
        text = text.slice(0, MAX) + `\n…[truncated, ${text.length - MAX} more chars]`;
      }

      return {
        content: [{ type: "text", text }],
        details: {
          connected,
          file: { path: file.path, uri: file.uri, languageId: file.languageId },
          selectionCount: selections.length,
          hasSelection: selections.some((s) => !s.isEmpty),
        },
      };
    },
  });

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;

    ctx.ui.setWidget(WIDGET_ID, (tui, theme) => {
      tuiRef = tui;
      return {
        render: (width: number) => renderWidget(theme, width),
        invalidate: () => {},
      };
    });

    connect();
  });

  pi.on("session_shutdown", () => {
    disconnect();
    tuiRef = null;
  });
}
