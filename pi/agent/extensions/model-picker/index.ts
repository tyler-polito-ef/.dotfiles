import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import {
  buildModelPickerView,
  showModelPickerOverlay,
  type ModelPickerAction,
} from "./model-picker-overlay.js";

/** Open the scoped-model picker and apply the user's selection. */
async function runModelPickerCommand(ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<void> {
  if (ctx.mode !== "tui") {
    const scoped = ctx.scopedModels;
    if (scoped.length === 0) {
      pi.sendMessage(
        {
          customType: "model-picker",
          content: "No scoped models configured.",
          display: true,
        },
        { triggerTurn: false },
      );
      return;
    }

    const current = ctx.model;
    const lines = scoped.map((entry) => {
      const ref = `${entry.model.provider}/${entry.model.id}`;
      const active = current && entry.model.provider === current.provider && entry.model.id === current.id;
      const thinking = entry.thinkingLevel ? ` (${entry.thinkingLevel})` : "";
      return active ? `• ${ref}${thinking}` : `  ${ref}${thinking}`;
    });
    pi.sendMessage(
      {
        customType: "model-picker",
        content: `Scoped models:\n${lines.join("\n")}`,
        display: true,
      },
      { triggerTurn: false },
    );
    return;
  }

  let selectedIndex: number | undefined;
  while (true) {
    const view = buildModelPickerView(ctx.scopedModels, ctx.model);
    const action = await showModelPickerOverlay(ctx, view, selectedIndex);
    if (action._tag === "close") return;

    selectedIndex = view.items.findIndex(
      (item) =>
        item.scoped.model.provider === action.item.scoped.model.provider &&
        item.scoped.model.id === action.item.scoped.model.id,
    );

    try {
      await applyModelSelection(ctx, pi, action);
      return;
    } catch (error) {
      ctx.ui.notify(formatPickerError(error), "error");
    }
  }
}

async function applyModelSelection(
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
  action: Extract<ModelPickerAction, { _tag: "select" }>,
): Promise<void> {
  const { scoped } = action.item;
  ctx.ui.setStatus("model-picker", ctx.ui.theme.fg("accent", "model:switching"));

  try {
    const success = await pi.setModel(scoped.model);
    if (!success) {
      throw new Error(`No API key for ${scoped.model.provider}/${scoped.model.id}`);
    }
    if (scoped.thinkingLevel) {
      pi.setThinkingLevel(scoped.thinkingLevel);
    }
    ctx.ui.notify(`Model: ${scoped.model.provider}/${scoped.model.id}`, "info");
  } finally {
    ctx.ui.setStatus("model-picker", undefined);
  }
}

function formatPickerError(error: unknown): string {
  return error instanceof Error ? `Model picker failed: ${error.message}` : "Model picker failed";
}

export default function modelPickerExtension(pi: ExtensionAPI) {
  pi.registerCommand("pick-model", {
    description: "Open the scoped model picker",
    handler: async (_args, ctx) => {
      await runModelPickerCommand(ctx, pi);
    },
  });

  pi.registerShortcut(Key.ctrlShift("m"), {
    description: "Open scoped model picker",
    handler: async (ctx) => {
      await runModelPickerCommand(ctx, pi);
    },
  });
}
