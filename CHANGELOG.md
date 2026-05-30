# Changelog

## 0.3.1
- Added: **Summon** — summon assistants to a floating pane to execute tasks
  - Registered as a pi tool; LLM can invoke `summon` to call a configured assistant
  - Added `/summon-setup` command: interactive TUI wizard to pick models and assign aliases
  - session_start auto-validates assistant configs (removes unavailable models)
  - First startup with no assistants → auto-launch setup wizard; partial invalidation → warn on startup
- Added: `callWorker` abstraction layer (`pane-comm/callWorker.ts`)
  - Extracted pane creation + readiness wait + message sending into a standalone module
  - /dd and /dc commands now call `callWorker`; removed `sendDelegate`
- Changed: config system overhaul
  - Migrated from "project-level override + package defaults" to a single user-level config (`~/.pi/agent/pi-in-zellij.json`)
  - First run auto-copies defaults from package
  - Added `saveConfig()`, `invalidateConfigCache()`, `AssistantConfig` type
- Changed: message protocol extended with `assistant` field (`msg-protocol.ts`)
- Changed: interceptor — added Summon branch handling; pane close now uses assistant alias instead of hardcoded `'worker'`
- Changed: UI prompts and notifications switched to English

## 0.2.3
- Fixed: removed debug `console.log` that polluted main pi TUI input
- Changed: error logging in worker readiness handler uses `console.error` instead of `console.log`

## 0.2.2
- Fixed: /dd command on Linux — prompt no longer requires manual Enter
  - Root cause: fixed sleep (1s) was too short for slower Linux startup
  - Solution: readiness file polling via `session_start` event, adaptive wait with 5s timeout
- Changed: `startupWaitSeconds` → `maxWaitSeconds` in config (default: 5)
- Added: CHANGELOG.md included in npm package

## 0.2.1
- Added: recursive scanning of nested directories for agent files

## 0.2.0
- Added: delegate with context via /dc command
- Added: auto-save and restore floating pane positions in zellij

## 0.1.0
- Initial release
- Multi-pane communication support (/dd)
- External editor support (alt+e)
