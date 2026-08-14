# AGENTS.md — TUI package

These rules supplement the package conventions in [packages/AGENTS.md](../../AGENTS.md).

- **Present TUI designs in tmux, not in the session transcript.** When tmux is available, run the assembled TUI in a pane of the same window the session runs in and point the user at it; print a rendering into the transcript only as a fallback.
