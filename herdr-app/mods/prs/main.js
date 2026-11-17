// The right-hand PRs panel: open PRs by a few people across a few repos, grouped by author. Click opens in the browser.
// PRs I've already approved (my latest review is an approval) are hidden unless "Show approved" is on.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, theme } from "herdr";

const AUTHORS = []; // GitHub usernames (redacted in backup)
const REPOS = []; // "owner/repo" entries (redacted in backup)
const REFRESH_MS = 120000;

const QUERY = ["is:pr", "is:open", ...AUTHORS.map((a) => `author:${a}`), ...REPOS.map((r) => `repo:${r}`)].join(" ");
const GQL = `query($q: String!) {
  search(query: $q, type: ISSUE, first: 100) {
    nodes { ... on PullRequest {
      number title url isDraft createdAt updatedAt reviewDecision
      author { login }
      viewerLatestReview { state }
      repository { name }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
    } }
  }
}`;

function age(iso, now) {
  const m = Math.floor((now - Date.parse(iso)) / 60000);
  if (m < 60) return `${Math.max(m, 1)}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

export default class Prs extends View {
  init(_props, cx) {
    this.prs = JSON.parse(localStorage.getItem("prs") ?? "null");
    this.error = null;
    this.loading = false;
    this.folded = new Set();
    this.showApproved = localStorage.getItem("showApproved") === "1";
    this.query = "";
    this.search = InputState.new({ placeholder: "Search PRs…" });
    this.search.on("change", (_e, cx) => { this.query = this.search.value(); cx.notify(); });
    this.search.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.search.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.refresh(cx);
    cx.timer.every(REFRESH_MS, (cx) => this.refresh(cx));
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await exec("gh", ["api", "graphql", "-f", `query=${GQL}`, "-f", `q=${QUERY}`], { timeout: 30000 });
        if (r.code !== 0) throw new Error(r.stderr.trim() || `gh exited ${r.code}`);
        const nodes = JSON.parse(r.stdout).data?.search?.nodes ?? [];
        this.prs = nodes.filter((n) => n?.number).map((n) => ({
          number: n.number,
          title: n.title,
          url: n.url,
          draft: n.isDraft,
          created: n.createdAt,
          updated: n.updatedAt,
          review: n.reviewDecision,
          checks: n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null,
          author: n.author?.login ?? "?",
          repo: n.repository?.name ?? "",
          // My latest review is an approval.
          approvedByMe: n.viewerLatestReview?.state === "APPROVED",
        }));
        localStorage.setItem("prs", JSON.stringify(this.prs));
        this.error = null;
      } catch (e) {
        this.error = String(e?.message ?? e).split("\n")[0];
      }
      this.loading = false;
      cx.notify();
    });
  }

  // Checks: spinner pending, red failing, green passing. Review: a small badge.
  checks(t, pr) {
    if (pr.checks === "PENDING" || pr.checks === "EXPECTED") return svg("mods/workspace-chrome/spinner.svg").size(11).flex_none().text_color(t.working).spin(900);
    const color = pr.checks === "SUCCESS" ? t.ansi2 : pr.checks === "FAILURE" || pr.checks === "ERROR" ? t.blocked : null;
    if (!color) return div().size(7).mx(2).flex_none().rounded(4).border(1.5).border_color(t.dim);
    return div().size(7).mx(2).flex_none().rounded(4).bg(color);
  }

  badge(t, pr) {
    const [label, color] = pr.draft ? ["Draft", t.dim]
      : pr.review === "APPROVED" ? ["Approved", t.ansi2]
      : pr.review === "CHANGES_REQUESTED" ? ["Changes", t.blocked]
      : [null, null];
    if (!label) return null;
    return div().flex_none().px(5).h(16).rounded(4).bg(color + "26").text_size(10).font_semibold().text_color(color).flex().items_center().child(label);
  }

  row(t, pr, now) {
    const tip = [
      `${pr.repo} #${pr.number}: ${pr.title}`,
      pr.draft ? "Draft" : pr.review ? `Review: ${pr.review.toLowerCase().replace("_", " ")}` : "Review: none yet",
      `Checks: ${pr.checks ? pr.checks.toLowerCase() : "none"}`,
    ].join("\n");
    const badge = this.badge(t, pr);
    return v_flex()
      .id(`pr-${pr.repo}-${pr.number}`)
      .px(8)
      .py(5)
      .flex_none()
      .rounded(8)
      .gap(2)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .tooltip(tip)
      .on_click(() => exec("open", [pr.url]))
      .child(h_flex().gap(7).items_center()
        .child(div().flex_1().min_w(0).truncate().text_color(pr.draft ? t.muted : t.foreground).child(pr.title))
        .child(this.checks(t, pr)))
      .child(h_flex().gap(6).items_center().text_size(11).text_color(t.dim)
        .child(div().flex_1().min_w(0).truncate().child(`${pr.repo.replace(/^repo-prefix-/, "")} #${pr.number}`))
        .when(Boolean(badge), (el) => el.child(badge))
        .child(div().flex_none().child(age(pr.updated, now))));
  }

  // A small switch under the search: show PRs I've already approved.
  approvedToggle(t, count) {
    const on = this.showApproved;
    return h_flex()
      .id("pr-show-approved")
      .mx(12)
      .mt(8)
      .px(2)
      .h(18)
      .flex_none()
      .gap(7)
      .items_center()
      .text_size(11.5)
      .text_color(on ? t.muted : t.dim)
      .cursor_pointer()
      .hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => {
        this.showApproved = !on;
        localStorage.setItem("showApproved", this.showApproved ? "1" : "0");
        cx.notify();
      })
      .child(
        h_flex().w(22).h(12).p(2).flex_none().rounded(6).items_center()
          .when(on, (el) => el.justify_end())
          .bg(on ? t.accent : t.border)
          .child(div().size(8).rounded(4).bg(on ? t.accent_foreground : t.muted)),
      )
      .child(div().child("Show approved"))
      .when(count > 0, (el) => el.child(div().text_color(t.dim).child(String(count))));
  }

  header(t, author, count) {
    const open = !this.folded.has(author);
    return h_flex()
      .id(`au-${author}`)
      .px(8)
      .pt(10)
      .h(36)
      .flex_none()
      .gap(7)
      .items_center()
      .text_size(13)
      .font_semibold()
      .text_color(t.muted)
      .cursor_pointer()
      .hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => {
        open ? this.folded.add(author) : this.folded.delete(author);
        cx.notify();
      })
      .child(div().truncate().child(author))
      .child(div().text_size(11.5).font_normal().text_color(t.dim).child(String(count)))
      .child(div().flex_1())
      .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none());
  }

  render(cx) {
    const t = theme();
    const now = Date.now();
    const all = this.prs ?? [];
    const approvedCount = all.filter((p) => p.approvedByMe).length;
    const prs = this.showApproved ? all : all.filter((p) => !p.approvedByMe);

    // Every word must match the title, repo, #number or author.
    const words = this.query.toLowerCase().split(/\s+/).filter(Boolean);
    const hay = (p) => `${p.title} ${p.repo} #${p.number} ${p.number} ${p.author}`.toLowerCase();
    const matching = prs.filter((p) => words.every((w) => hay(p).includes(w)));
    const rows = AUTHORS.flatMap((author) => {
      const mine = matching.filter((p) => p.author === author).sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated));
      if (!mine.length) return [];
      return [this.header(t, author, mine.length), ...(this.folded.has(author) ? [] : mine.map((p) => this.row(t, p, now)))];
    });

    return v_flex()
      .id("prs")
      .size_full()
      .min_h(0)
      .rounded(10)
      .overflow_hidden()
      .bg(t.background)
      .border_1()
      .border_color(t.border)
      .text_color(t.foreground)
      .text_size(12.5)
      .child(
        h_flex().px(16).h(40).flex_none().border_b(1).border_color(t.border).items_center().justify_between()
          .child(h_flex().gap(6).items_center()
            .child(svg("mods/prs/pull-request.svg").size(14).text_color(t.muted))
            .child(div().text_size(12.5).font_medium().child("Pull requests"))
            .when(prs.length > 0, (el) => el.child(div().text_size(11).text_color(t.dim).child(String(prs.length)))))
          .child(
            div().id("pr-refresh").text_color(t.dim).cursor_pointer()
              .hover((s) => s.text_color(t.foreground))
              .tooltip(this.loading ? "Refreshing…" : "Refresh")
              .on_click((_e, cx) => this.refresh(cx))
              .child(this.loading
                ? svg("mods/workspace-chrome/spinner.svg").size(13).spin(900)
                : svg("mods/prs/refresh.svg").size(13)),
          ),
      )
      .child(
        h_flex().id("pr-search").mx(12).mt(10).h(32).px(10).gap(7).flex_none().items_center().rounded(8)
          .border_1().border_color(this.typing ? t.accent : t.border).bg(t.background).cursor_text()
          .child(svg("mods/workspace-chrome/search.svg").size(13).flex_none().text_color(t.dim))
          .child(Input.new(this.search).flex_1().min_w(0).h_full().text_size(12.5).text_color(t.foreground))
          .when(this.query.length > 0, (el) => el.child(
            div().id("pr-search-clear").flex_none().text_color(t.dim).cursor_pointer()
              .hover((s) => s.text_color(t.foreground))
              .tooltip("Clear")
              .on_click((_e, cx) => { this.search.set_value(""); this.query = ""; cx.notify(); })
              .child(svg("mods/workspace-chrome/x.svg").size(12)))),
      )
      .child(this.approvedToggle(t, approvedCount))
      .when(words.length > 0 && matching.length === 0 && prs.length > 0, (el) =>
        el.child(div().px(16).pt(10).text_size(12).text_color(t.dim).child("No PRs match.")))
      .when(Boolean(this.error), (el) => el.child(div().px(16).pt(8).text_size(11).text_color(t.blocked).child(this.error)))
      .when(this.prs !== null && prs.length === 0 && !this.error, (el) =>
        el.child(div().px(16).pt(10).text_size(12).text_color(t.dim).child("No open PRs.")))
      .when(this.prs === null && !this.error, (el) =>
        el.child(div().px(16).pt(10).text_size(12).text_color(t.dim).child("Loading…")))
      .child(v_flex().id("pr-list").flex_1().min_h(0).px(8).pb(8).overflow_y_scrollbar().children(rows));
  }
}
