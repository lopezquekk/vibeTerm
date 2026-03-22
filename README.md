# vibeTerm

A contextual terminal workspace built for developers who work with multiple projects, git branches, and Claude Code simultaneously.

---

## What is vibeTerm?

vibeTerm is a desktop terminal app (macOS) that organizes your shell sessions into **named contexts** — think of it like browser tabs, but for terminals. Each context keeps its own PTY session alive, tracks the git state of the folder you're in, and lets you inspect diffs and commit history without leaving the app.

Built with **Tauri 2** (Rust backend) + **React** frontend + **xterm.js**.

---

## Features

- **Multi-context sidebar** — create named terminal workspaces, switch between them without losing session state
- **Tab persistence** — all terminal sessions stay alive in the background; switching tabs only changes visibility
- **Real-time CWD tracking** — the sidebar path and git branch update automatically as you `cd` between folders (via OSC 7)
- **Git Diff panel** — file browser showing modified/added/deleted files with a GitHub Desktop-style diff viewer (line numbers, +/− gutter)
- **Git History panel** — full commit log with local vs pushed distinction, per-commit file list, and inline diff viewer
- **Image diffs** — PNG/JPG/SVG and other image files are shown as before/after previews instead of binary output
- **Collapsible sidebar** — docked, floating (Arc-style overlay), or hidden with a keyboard shortcut
- **Tab renaming** — double-click any sidebar tab to rename it

---

## Installation

### Requirements

- macOS 13+ (tested on macOS 15 Sequoia)
- [Rust](https://rustup.rs/) (stable toolchain)
- [Node.js](https://nodejs.org/) 18+ and [pnpm](https://pnpm.io/)
- Xcode Command Line Tools: `xcode-select --install`

### Run in development

```bash
git clone https://github.com/youruser/vibeterm.git
cd vibeterm
pnpm install
pnpm tauri dev
```

### Build for production

```bash
pnpm tauri build
```

The `.dmg` installer will be in `src-tauri/target/release/bundle/dmg/`.

---

## How to use

### Creating contexts

Click the **`+`** button in the sidebar header to create a new terminal context. Each context gets its own shell session starting in `~`.

To rename a context, **double-click** its name in the sidebar and type a new alias. Press **Enter** to confirm or **Escape** to cancel.

### Switching between contexts

Click any context in the sidebar to switch to it. The previous terminal session keeps running in the background — your history, running processes, and scroll position are all preserved.

### Sidebar modes

The sidebar has three modes, toggled with **`⌘\`** or the buttons in the header:

| Mode | Behavior |
|------|----------|
| **Docked** | Sidebar is fixed to the left, pushes the terminal content |
| **Floating** | Sidebar overlays the content (Arc-style); click outside to dismiss |
| **Hidden** | Sidebar is hidden; click the thin strip on the left edge to bring it back as floating |

The `‹` chevron button always collapses the sidebar. The pin `⊕` button (visible only in floating mode) docks it permanently.

### Panel tabs

Each context has four panel tabs at the top of the main area:

#### Terminal

Your actual shell. The session is created when the tab first becomes visible and stays alive as long as the context exists. Closing a context kills the PTY session.

The terminal automatically resizes when the window is resized or when focus returns to the app after switching to another application.

#### Git Diff

Shows working-tree changes — files you've modified, added, or deleted but haven't committed yet.

- **Left column**: list of changed files with status badges (`M` modified, `A` added, `D` deleted, `U` untracked)
- **Right pane**: diff for the selected file with line numbers and color coding
- For image files (PNG, JPG, SVG, etc.), shows a before/after visual comparison instead of a text diff
- Refreshes automatically every 3 seconds

#### Git History

The full commit log for the current branch.

- **Commits column** (left): each commit shows its hash, message, author, and relative date
  - **`LOCAL`** badge (yellow) = commit exists only on your machine, not yet pushed to remote
  - Gray dot = commit has been pushed to remote
- **Files column** (middle): files changed in the selected commit
- **Diff column** (right): diff for the selected file in that commit, with the same image diff support as the Git Diff panel

#### Changes

Coming soon.

---

## Real-time path tracking

vibeTerm uses **OSC 7** escape sequences to track where your shell actually is. When you `cd` to a new directory, the sidebar updates the path and re-fetches the git status automatically.

This works out of the box with:
- **zsh** on macOS (the default shell emits OSC 7 via `update_terminal_cwd` in `/etc/zshrc`)
- **fish** shell
- Most modern shells with OSC 7 configured

If your shell doesn't emit OSC 7, the path shown in the sidebar stays as the initial working directory — nothing breaks, it just won't update dynamically.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | [Tauri 2](https://tauri.app/) |
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS |
| Terminal emulator | [xterm.js](https://xtermjs.org/) v5 |
| PTY (pseudoterminal) | [portable-pty](https://crates.io/crates/portable-pty) |
| State management | Zustand (persisted to localStorage) |
| Git operations | `git` CLI via `std::process::Command` |

---

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘\` | Toggle sidebar hidden ↔ docked |
| Double-click tab name | Rename context |
| `Enter` | Confirm rename |
| `Escape` | Cancel rename |

---

## macOS Sequoia compatibility

vibeTerm patches the `tao` windowing library to fix a startup crash on macOS 15 Sequoia. The crash was caused by an ObjC exception (`NSImageCacheException`) propagating through an `extern "C"` FFI boundary, combined with `+[NSThread isMainThread]` returning incorrect results inside `applicationDidFinishLaunching`.

The patch (in `patches/tao/`, applied via `[patch.crates-io]` in `Cargo.toml`) makes two fixes:
1. Uses `pthread_main_np()` instead of `+[NSThread isMainThread]` for main-thread detection
2. Wraps `applicationDidFinishLaunching` in `objc2::exception::catch` so ObjC exceptions print a useful message instead of silently aborting
