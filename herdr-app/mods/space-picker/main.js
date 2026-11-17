// Go to a space. One row per space, in sidebar order (same as ctrl-1..9).
// Type to filter (name, branch, tab names, agents), ↑/↓ or cmd-j/cmd-k to
// move, Enter to go, ctrl-d to close the space (asks first), Esc to leave.
// Last rows: a new space on this computer or on each connected machine.
// Cloned from the shipped `picker` (which goes to tabs).

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, spaces, run, hc, theme, settings, props, closeOverlay, shared, setShared } from "herdr";

const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// Space colors, shared with the other mods in "space.colors" (same rule as
// the shipped picker/spaces mods, so they agree).
const PROJECT_COLORS = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
function spaceColors() {
  const ids = new Set(spaces().map((p) => p.id));
  const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
  let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
  for (const p of spaces()) {
    if (kept[p.id] || p.name === "~") continue;
    const uses = (c) => Object.values(kept).filter((v) => v === c).length;
    kept[p.id] = PROJECT_COLORS.reduce((best, c) => (uses(c) < uses(best) ? c : best));
    changed = true;
  }
  if (changed) setShared("space.colors", kept);
  return kept;
}
function spaceColor(t, p) {
  if (p.name === "~") return t.dim;
  const c = spaceColors()[p.id] ?? PROJECT_COLORS[0];
  return c.startsWith("#") ? c : (MARK[c] ?? t[c]);
}

const ROW = 40;
const NEW_ROW = 32;
const MAX_LIST = 360;

export default class SpacePicker extends View {
  init(_props, cx) {
    this.filter = "";
    this.input = InputState.new({ placeholder: "Go to a space…" });
    this.input.on("change", (_e, cx) => {
      this.filter = this.input.value();
      this.at = 0;
      cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.go(this.rows()[this.at], cx));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.at = null;
    this.scroll = 0;
    this.machines = [];
    this.handle = cx.focus_handle();
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["machine", "ls", "--json"]);
        if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => m.state === "connected" && !m.temporary).map((m) => m.name);
      } catch {}
      cx.notify();
    });
  }

  close() {
    closeOverlay(props().overlay);
  }

  rows() {
    const f = this.filter.toLowerCase();
    const all = agents();
    const out = [];
    for (const w of spaces()) {
      const mine = all.filter((a) => a.space === w.id);
      const hay = [w.name, w.branch ?? "", w.machine ?? "", ...w.tabs.map((c) => c.name), ...mine.map((a) => a.program?.name ?? "")].join(" ").toLowerCase();
      if (!f || hay.includes(f)) out.push({ kind: "space", w, mine });
    }
    out.push({ kind: "new", machine: null });
    for (const m of this.machines) out.push({ kind: "new", machine: m });
    return out;
  }

  go(r) {
    if (!r) return;
    this.close();
    if (r.kind === "space") run("space.select", { id: r.w.id });
    else run("space.new", { machine: r.machine ?? "" });
  }

  glyph(t, st) {
    if (st === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900);
    return div().w(12).flex_none().text_color(t[st] ?? t.dim).child(st === "idle" ? "○" : st ? "●" : "·");
  }

  render() {
    const t = theme();
    const rows = this.rows();
    // Opens on the shown space.
    if (this.at === null) this.at = Math.max(0, rows.findIndex((r) => r.kind === "space" && r.w.active));
    this.at = Math.max(0, Math.min(this.at, rows.length - 1));
    const sel = rows[this.at];

    // Rows at fixed y; scroll only as far as needed to keep the selection in view.
    const H = (r) => (r.kind === "space" ? ROW : NEW_ROW);
    const tops = [];
    let y = 0;
    rows.forEach((r) => { tops.push(y); y += H(r); });
    const total = y;
    const height = Math.min(MAX_LIST, this.listHeight ?? MAX_LIST);
    const fixed = total > height;
    const maxScroll = Math.max(0, total - height);
    this.scroll = Math.max(0, Math.min(this.scroll, maxScroll));
    if (sel) {
      const i = this.at;
      if (tops[i] < this.scroll) this.scroll = tops[i];
      if (tops[i] + H(sel) > this.scroll + height) this.scroll = tops[i] + H(sel) - height;
    }
    const place = (el, i) =>
      fixed ? el.absolute().left(0).right(0).top(tops[i] - this.scroll).bottom(height - (tops[i] + H(rows[i]) - this.scroll)) : el;
    const visible = (i) => !fixed || (tops[i] + H(rows[i]) > this.scroll && tops[i] < this.scroll + height);

    const row = (r, i) => {
      const on = i === this.at;
      if (r.kind === "new") {
        return h_flex()
          .id(`sp-new-${r.machine ?? "here"}`)
          .mx(4)
          .px(10)
          .h(NEW_ROW)
          .items_center()
          .rounded(7)
          .gap(8)
          .text_color(t.muted)
          .cursor_pointer()
          .when(on, (el) => el.bg(t.hover))
          .hover((s) => s.bg(t.hover))
          .on_click(() => this.go(r))
          .child(div().w(12).child("+"))
          .child(r.machine ? `new space on ${r.machine}` : "new space");
      }
      const w = r.w;
      const n = w.tabs.length;
      const who = [...new Set(r.mine.map((a) => a.program?.name ?? "agent"))].join(" · ");
      const meta = [w.branch, `${n} tab${n === 1 ? "" : "s"}`, w.machine].filter(Boolean).join("  ·  ");
      return h_flex()
        .id(`sp-${w.id}`)
        .mx(4)
        .px(10)
        .h(ROW)
        .rounded(7)
        .gap(10)
        .items_center()
        .cursor_pointer()
        .when(on, (el) => el.bg(t.hover))
        .hover((s) => s.bg(t.hover))
        .on_click(() => this.go(r))
        .child(this.glyph(t, w.status))
        .child(h_flex().size(20).flex_none().rounded(5).bg(spaceColor(t, w)).items_center().justify_center().text_size(11).font_bold().text_color("#ffffff").child([...w.name][0]?.toUpperCase() ?? "?"))
        .child(
          v_flex().flex_1().min_w(0)
            .child(div().truncate().text_color(t.foreground).when(w.active, (d) => d.font_semibold()).child(w.name))
            .child(div().truncate().text_size(11).text_color(t.dim).child(meta)),
        )
        .when(w.status === "blocked", (el) => el.child(div().text_size(11).text_color(t.blocked).child("needs you")))
        .when(w.status === "done", (el) => el.child(div().text_size(11).text_color(t.done).child("finished")))
        .when(!!who, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(who)));
    };

    const move = (d) => { this.at = (this.at + d + rows.length) % rows.length; };

    return v_flex()
      .id("space-picker")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(18)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        const k = e.key;
        const m = e.modifiers;
        if (k === "escape") return this.close();
        if (k === "down" || (m.platform && k === "j")) move(1);
        else if (k === "up" || (m.platform && k === "k")) move(-1);
        else if (k === "d" && m.control) {
          if (sel?.kind === "space") {
            this.close();
            run("space.close", { id: sel.w.id });
          }
        } else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Go to space…")).child(div().id("sp-esc").px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => this.close()).child("Esc")))
      .child(
        h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
          .child(svg("mods/workspace-chrome/search.svg").size(15).text_color(t.dim))
          .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)),
      )
      .child(
        v_flex()
          .id("sp-list")
          .on_size_change((size, cx) => {
            this.listHeight = size.height / settings().zoom;
            cx.notify();
          })
          .h(Math.min(MAX_LIST, total))
          .min_h(0)
          .mb(6)
          .when(fixed, (el) =>
            el.overflow_hidden().on_scroll_wheel((e, cx) => {
              this.scroll = Math.max(0, Math.min(this.scroll - e.delta.y, maxScroll));
              while (this.at < rows.length - 1 && tops[this.at] < this.scroll) this.at++;
              while (this.at > 0 && tops[this.at] + H(rows[this.at]) > this.scroll + height) this.at--;
              cx.notify();
            }))
          .children(rows.map((r, i) => (visible(i) ? place(row(r, i), i) : null)).filter(Boolean)),
      );
  }
}
