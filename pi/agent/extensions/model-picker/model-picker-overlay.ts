import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionContext, ScopedModel, Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, type TUI, visibleWidth } from "@earendil-works/pi-tui";

/** One selectable model shown in the picker. */
export interface ModelPickerItem {
  readonly scoped: ScopedModel;
  readonly label: string;
  readonly detail: string;
  readonly isCurrent: boolean;
}

/** View model for the model picker overlay. */
export interface ModelPickerView {
  readonly items: readonly ModelPickerItem[];
  readonly currentModel: Model<unknown> | undefined;
}

/** User intent returned by the model picker overlay. */
export type ModelPickerAction =
  | { readonly _tag: "close" }
  | { readonly _tag: "select"; readonly item: ModelPickerItem };

/** Show the interactive model picker over the current Pi transcript. */
export async function showModelPickerOverlay(
  ctx: ExtensionContext,
  view: ModelPickerView,
  selectedIndex?: number,
): Promise<ModelPickerAction> {
  return ctx.ui.custom<ModelPickerAction>(
    (tui, theme, _keybindings, done) =>
      new ModelPickerOverlay(tui, theme, view, selectedIndex ?? findCurrentIndex(view), done),
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: "90%",
        maxHeight: "82%",
        minWidth: 56,
      },
    },
  );
}

function findCurrentIndex(view: ModelPickerView): number {
  const index = view.items.findIndex((item) => item.isCurrent);
  return Math.max(0, index);
}

class ModelPickerOverlay {
  private selectedIndex: number;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly view: ModelPickerView,
    selectedIndex: number,
    private readonly done: (action: ModelPickerAction) => void,
  ) {
    this.selectedIndex = view.items.length === 0 ? 0 : clamp(selectedIndex, 0, view.items.length - 1);
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
      this.done({ _tag: "close" });
      return;
    }
    if (matchesKey(data, Key.up) || data === "k") {
      this.moveSelection(-1);
      return;
    }
    if (matchesKey(data, Key.down) || data === "j") {
      this.moveSelection(1);
      return;
    }

    const item = this.getSelectedItem();
    if (item === undefined) return;
    if (matchesKey(data, Key.enter)) {
      this.done({ _tag: "select", item });
    }
  }

  render(width: number): string[] {
    const innerWidth = Math.max(20, width - 2);
    const bodyHeight = this.getBodyHeight();
    const body = innerWidth < 56
      ? this.renderModelList(innerWidth, bodyHeight).map((line) => frameLine(this.theme, line, innerWidth))
      : this.renderTwoColumnBody(innerWidth, bodyHeight);

    return [
      topBorder(this.theme, innerWidth),
      frameLine(this.theme, this.renderHeader(innerWidth), innerWidth),
      divider(this.theme, innerWidth),
      ...body,
      divider(this.theme, innerWidth),
      frameLine(
        this.theme,
        this.theme.fg("dim", "↑↓/jk move • enter select • esc close"),
        innerWidth,
      ),
      bottomBorder(this.theme, innerWidth),
    ];
  }

  invalidate(): void {}

  private renderTwoColumnBody(innerWidth: number, bodyHeight: number): string[] {
    const listWidth = Math.floor((innerWidth - 1) * 0.52);
    const detailWidth = innerWidth - listWidth - 1;
    const separator = this.theme.fg("borderMuted", "│");
    return combineColumns(
      this.renderModelList(listWidth, bodyHeight),
      this.renderSelectedDetails(detailWidth, bodyHeight),
      listWidth,
      detailWidth,
      separator,
    ).map((line) => frameLine(this.theme, line, innerWidth));
  }

  private renderHeader(width: number): string {
    const title = this.theme.fg("accent", this.theme.bold("Pick Model"));
    const summary = this.theme.fg(
      "muted",
      `${this.view.items.length} scoped • ${formatModelRef(this.view.currentModel) ?? "none"}`,
    );
    const gap = Math.max(1, width - visibleWidth(title) - visibleWidth(summary));
    return `${title}${" ".repeat(gap)}${summary}`;
  }

  private renderModelList(width: number, height: number): string[] {
    if (this.view.items.length === 0) {
      return padLines(
        [
          this.theme.fg("dim", "No scoped models configured."),
          this.theme.fg("dim", "Add enabledModels to settings or use /scoped-models."),
        ],
        height,
      );
    }

    this.selectedIndex = clamp(this.selectedIndex, 0, this.view.items.length - 1);
    const start = Math.max(
      0,
      Math.min(this.selectedIndex - Math.floor(height / 2), Math.max(0, this.view.items.length - height)),
    );
    const end = Math.min(this.view.items.length, start + height);
    const lines: string[] = [];

    for (let index = start; index < end; index += 1) {
      const item = this.view.items[index];
      if (item === undefined) continue;
      const selected = index === this.selectedIndex;
      const cursor = selected ? "›" : " ";
      const marker = item.isCurrent ? "●" : " ";
      const row = `${cursor}${marker} ${item.label}`;
      lines.push(selected ? this.theme.fg("accent", this.theme.bold(fitLine(row, width))) : fitLine(row, width));
    }

    return padLines(lines, height);
  }

  private renderSelectedDetails(width: number, height: number): string[] {
    const item = this.getSelectedItem();
    if (item === undefined) {
      return padLines([this.theme.fg("dim", "Configure enabledModels in ~/.pi/agent/settings.json")], height);
    }

    const { scoped } = item;
    const lines = [
      this.theme.fg("accent", this.theme.bold(item.label)),
      "",
      `${this.theme.fg("muted", "Provider:")} ${scoped.model.provider}`,
      `${this.theme.fg("muted", "Model:")} ${scoped.model.id}`,
    ];
    if (scoped.model.name && scoped.model.name !== scoped.model.id) {
      lines.push(`${this.theme.fg("muted", "Name:")} ${scoped.model.name}`);
    }
    if (scoped.thinkingLevel) {
      lines.push(`${this.theme.fg("muted", "Thinking:")} ${scoped.thinkingLevel}`);
    }
    if (item.isCurrent) {
      lines.push("", this.theme.fg("success", "Currently active"));
    }
    if (scoped.model.contextWindow) {
      lines.push(`${this.theme.fg("muted", "Context:")} ${formatTokenCount(scoped.model.contextWindow)}`);
    }
    if (scoped.model.maxTokens) {
      lines.push(`${this.theme.fg("muted", "Max output:")} ${formatTokenCount(scoped.model.maxTokens)}`);
    }
    return padLines(lines.map((line) => truncateToWidth(line, width)), height);
  }

  private moveSelection(delta: number): void {
    if (this.view.items.length === 0) return;
    this.selectedIndex = clamp(this.selectedIndex + delta, 0, this.view.items.length - 1);
    this.tui.requestRender();
  }

  private getSelectedItem(): ModelPickerItem | undefined {
    return this.view.items[this.selectedIndex];
  }

  private getBodyHeight(): number {
    const rows = this.tui.terminal.rows ?? 30;
    return clamp(Math.floor(rows * 0.55), 6, 24);
  }
}

export function buildModelPickerView(
  scopedModels: readonly ScopedModel[],
  currentModel: Model<unknown> | undefined,
): ModelPickerView {
  const items = scopedModels.map((scoped): ModelPickerItem => {
    const label = `${scoped.model.provider}/${scoped.model.id}`;
    const detailParts: string[] = [];
    if (scoped.thinkingLevel) detailParts.push(`thinking:${scoped.thinkingLevel}`);
    if (scoped.model.name && scoped.model.name !== scoped.model.id) detailParts.push(scoped.model.name);
    return {
      scoped,
      label,
      detail: detailParts.join(" • "),
      isCurrent: isSameModel(scoped.model, currentModel),
    };
  });

  return { items, currentModel };
}

function isSameModel(left: Model<unknown>, right: Model<unknown> | undefined): boolean {
  if (right === undefined) return false;
  return left.provider === right.provider && left.id === right.id;
}

function formatModelRef(model: Model<unknown> | undefined): string | undefined {
  if (model === undefined) return undefined;
  return `${model.provider}/${model.id}`;
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

function fitLine(text: string, width: number): string {
  const truncated = truncateToWidth(text, Math.max(0, width));
  return `${truncated}${" ".repeat(Math.max(0, width - visibleWidth(truncated)))}`;
}

function frameLine(theme: Theme, content: string, innerWidth: number): string {
  return `${theme.fg("borderAccent", "│")}${fitLine(content, innerWidth)}${theme.fg("borderAccent", "│")}`;
}

function topBorder(theme: Theme, innerWidth: number): string {
  return theme.fg("borderAccent", `┌${"─".repeat(innerWidth)}┐`);
}

function divider(theme: Theme, innerWidth: number): string {
  return theme.fg("borderMuted", `├${"─".repeat(innerWidth)}┤`);
}

function bottomBorder(theme: Theme, innerWidth: number): string {
  return theme.fg("borderAccent", `└${"─".repeat(innerWidth)}┘`);
}

function combineColumns(
  left: readonly string[],
  right: readonly string[],
  leftWidth: number,
  rightWidth: number,
  separator: string,
): string[] {
  const rows = Math.max(left.length, right.length);
  const lines: string[] = [];
  for (let index = 0; index < rows; index += 1) {
    lines.push(`${fitLine(left[index] ?? "", leftWidth)}${separator}${fitLine(right[index] ?? "", rightWidth)}`);
  }
  return lines;
}

function padLines(lines: readonly string[], height: number): string[] {
  const padded = [...lines];
  while (padded.length < height) padded.push("");
  return padded.slice(0, height);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
