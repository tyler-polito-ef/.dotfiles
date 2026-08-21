# pi-worktrees

A pi extension that syncs with [herdr](https://herdr)'s worktree state.

Adds a `/wt` slash command that drives herdr's git-worktree-backed workspaces
from inside a pi session. Listing reads live herdr state, so `/wt list` always
reflects worktrees created outside pi too.

## Requirements

- `herdr` on `$PATH` (`pi.exec("herdr", …)`)
- A running herdr server (the CLI talks to it over its socket)
- The current pi `cwd` should be inside a git work tree

## Usage

```
/wt                       Show usage
/wt new [branch]          Create + open a herdr worktree
    [--base REF] [--label TEXT] [--focus|--no-focus]
/wt list                  List worktrees; pick one to open
/wt delete [workspace_id] Remove a worktree workspace (picker if id omitted)
    [--force]
```

### `/wt new`
- Prompts for a branch name if you don't pass one.
- `--base REF` sets the base ref to branch from.
- `--label TEXT` names the herdr workspace.
- Defaults to `--no-focus` so your current pi session stays focused; pass
  `--focus` to focus the new workspace in herdr.

### `/wt list`
Fetches the live worktree set from herdr and shows a selector. Selecting an
entry offers to open it (`herdr worktree open`).

### `/wt delete`
Lists open linked worktrees and lets you pick one to remove. Only linked
worktrees that herdr has open as workspaces are offered, since
`herdr worktree remove` takes a workspace id and the main checkout shouldn't
be removed this way. Pass a workspace id directly to skip the picker, and
`--force` to force removal.

## How it works

Every subcommand shells out to the `herdr` CLI and parses its JSON envelope:

- success → `{"id": "...", "result": { ... }}`
- error   → `{"error": {"code": "...", "message": "..."}, "id": "..."}`

Errors are surfaced as notifications; the structured result drives the UI.

## Install

This file lives at `~/.pi/agent/extensions/pi-worktrees/index.ts`, which pi
auto-discovers. Run `/reload` after editing.
