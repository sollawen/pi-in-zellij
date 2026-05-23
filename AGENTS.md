# Agents

可用 agent 列表通过 `lib/agents.ts` 自动扫描以下目录构建：

- 项目 `.pi/agents/` 目录（向上逐级搜索）
- 全局 `~/.pi/agent/agents/` 目录

同名 agent 项目级优先于全局。