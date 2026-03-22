# vibeTerm

**A contextual terminal workspace for developers juggling multiple projects, git branches, and AI coding sessions.**

Built with Tauri 2 (Rust) · React · xterm.js · macOS

---

## What is it?

vibeTerm organizes your shell sessions into **named contexts** — like browser tabs, but for terminals. Each context keeps its own PTY session alive in the background, tracks the git state of your current directory in real time, and lets you inspect diffs and commit history without ever leaving the app.

Designed for workflows where you're constantly switching between a main repo, feature branches, and git worktrees.

---

## Features

### Terminal workspace
- **Named contexts** — create as many shell sessions as you need, each with its own alias, path, and session state
- **Persistent sessions** — switching contexts never kills the shell; processes keep running, scroll history is preserved
- **Real-time CWD tracking** — the sidebar path and git branch update automatically as you `cd` (via OSC 7)
- **Git worktree grouping** — tabs that are linked worktrees of another tab are automatically nested beneath their parent in the sidebar with a visual indent and `⎇` indicator

### Git panels
- **Git Diff** — file browser of working-tree changes with a GitHub Desktop-style diff viewer (line numbers, +/− gutter, image before/after)
- **Git History** — full commit log with LOCAL/pushed distinction, per-commit file list, and inline diff
- **Image diffs** — PNG, JPG, SVG, and other images show visual before/after comparisons instead of binary output

### UI
- **Collapsible sidebar** — docked (pushes content), floating (Arc-style overlay), or hidden
- **Tab renaming** — double-click any context name to rename it inline
- **Dark theme** — zinc/slate palette with a blue accent, optimized for long coding sessions

---

## Installation

### Requirements

- macOS 13 or later (tested on macOS 15 Sequoia)
- [Rust](https://rustup.rs/) stable toolchain
- [Node.js](https://nodejs.org/) 18+ and [pnpm](https://pnpm.io/)
- Xcode Command Line Tools — `xcode-select --install`

### Development

```bash
git clone https://github.com/youruser/vibeterm.git
cd vibeterm
pnpm install
pnpm tauri dev
```

### Production build

```bash
pnpm tauri build
```

The `.dmg` installer lands in `src-tauri/target/release/bundle/dmg/`.

---

## Usage

### Creating and managing contexts

| Action | How |
|--------|-----|
| New context | Click **`+`** in the sidebar header |
| Switch context | Click any sidebar item |
| Rename context | Double-click the name → type → **Enter** |
| Close context | Hover the item → click **`✕`** (kills the PTY session) |

### Sidebar modes

Toggle with **`⌘\`** or the header buttons:

| Mode | Behavior |
|------|----------|
| **Docked** | Fixed to the left; pushes terminal content |
| **Floating** | Overlays content (Arc-style); click outside to dismiss |
| **Hidden** | Collapsed; click the left edge strip to bring it back as floating |

### Panel tabs

Each context has four panels at the top of the main area:

**Terminal** — your shell. Created on first view, stays alive until the context is closed.

**Git Diff** — working-tree changes. File list on the left, diff on the right. Refreshes every 3 seconds. Click any file to see its diff; image files show a visual before/after instead of binary noise.

**Git History** — full commit log. Select a commit to browse its changed files and diffs. `LOCAL` badge (yellow) marks commits not yet pushed to remote.

**Changes** — staging area and commit UI *(coming soon)*.

### Git worktree grouping

If you open contexts for both a main repo and one of its linked worktrees, vibeTerm detects the relationship automatically and moves the worktree context to appear directly below its parent in the sidebar — indented with a left border and an `⎇` branch icon.

No configuration needed; detection happens via `git worktree list` on session start and on every directory change.

---

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘\` | Toggle sidebar hidden ↔ docked |
| Double-click tab | Rename context |
| `Enter` | Confirm rename |
| `Escape` | Cancel rename |

---

## Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | [Tauri 2](https://tauri.app/) |
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS |
| Terminal emulator | [xterm.js](https://xtermjs.org/) v5 |
| PTY | [portable-pty](https://crates.io/crates/portable-pty) |
| State | Zustand (persisted to localStorage) |
| Git | `git` CLI via `std::process::Command` |

---

## OSC 7 — how CWD tracking works

vibeTerm listens for [OSC 7](https://iterm2.com/documentation-escape-codes.html) escape sequences emitted by the shell when the current directory changes. The sidebar path and git status update instantly on every `cd`.

Works out of the box with:
- **zsh** on macOS (default — emits OSC 7 via `update_terminal_cwd` in `/etc/zshrc`)
- **fish** shell
- Any shell configured to emit `\e]7;file://host/path\a`

If your shell doesn't emit OSC 7 the sidebar path stays fixed at the session's starting directory — nothing breaks.

---

## macOS Sequoia compatibility

vibeTerm patches the `tao` windowing library to fix a startup crash on macOS 15. The crash originated from `+[NSThread isMainThread]` returning `NO` inside `applicationDidFinishLaunching` on Sequoia, causing an ObjC exception to propagate through an `extern "C"` FFI boundary.

The patch in `patches/tao/` (applied via `[patch.crates-io]` in `Cargo.toml`) makes two fixes:

1. Replaces `+[NSThread isMainThread]` with `pthread_main_np()` for correct main-thread detection on Sequoia
2. Wraps `applicationDidFinishLaunching` in `objc2::exception::catch` so ObjC exceptions surface as readable errors instead of silent aborts
