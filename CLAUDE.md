# Claude Code Guide

The project rules are shared with Codex and live in one place, `AGENTS.md`. Follow them.

@AGENTS.md

## Working on this machine (Windows)

- The path contains Japanese characters. Use PowerShell; `cd` in Git Bash fails on it.
- Run git as `git -c safe.directory=C:/Users/yuto1/OneDrive/デスクトップ/開発/my-planner ...`. Do not change the global git config.
- After a production deploy, confirm it by fetching `https://my-planner-five-alpha.vercel.app/sw.js` and checking `CACHE_VER`.
- After pushing, check the `Repository checks` workflow (`gh run list -R yuto-labs/my-planner --workflow check.yml`). A failure only on Windows usually means CRLF line endings.
- Reply to the owner in Japanese, and explain what changed and why in plain words.
