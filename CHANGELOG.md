# Changelog

## 0.3.2
- Added: automatic summon-setup wizard on first startup when no assistants configured
  - Startup + empty assistants → shows prompt + launches wizard
  - Startup + invalid assistants → shows warning + launches wizard
  - Reload/other scenarios → shows sendMessage hint only (no wizard)
  - Extracted `runSummonSetup()` from command handler for reuse

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
