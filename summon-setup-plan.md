# Summon 助手配置方案

## 问题

1. 新用户不知道需要在配置里手写模型名
2. 写错了模型名（或模型后来不可用了），pane 闪退，没有任何错误提示
3. ~~配置文件只有项目级路径，没有用户级全局配置~~ ✅ 已解决

## 方案概览

| # | 内容 | 效果 | 状态 |
|---|------|------|------|
| A | 初始化时校验 assistants 模型有效性 | 无效模型不再静默失败 | |
| B | `/summon-setup` 向导命令 | 用户不需要知道模型字符串格式 | |
| C | 用户级全局配置路径 | 一次配置，所有项目通用 | ✅ 已完成 |

## 模型 ID 规则

配置和显示中，模型 ID 只用 `provider/id`（如 `minimax-cn/MiniMax-M2.7`），**不带 thinking level 后缀**（如 `:medium`、`:high`）。

`ctx.modelRegistry.getAvailable()` 返回的 `model.id` 本身不含 thinking level，所以向导选出来的天然就是干净的。包内默认 `config.json` 里的旧格式（如 `MiniMax-M2.7:medium`）在用户运行 `/summon-setup` 后会被覆盖。

thinking level 支持以后再加。

---

## ~~C. 增加用户级全局配置路径~~ ✅ 已完成

已实现并测试通过。详见 `plan-config-path.md`。

改动：`config.ts`，使用 `getAgentDir()` + `~/.pi/agent/pi-in-zellij.json` 作为唯一配置来源，首次使用时从包内 `config.json` 复制。

---

## A. 初始化校验

### 触发时机

`session_start` 事件中，读取 config 后立即校验。

### 校验逻辑

```
1. loadConfig() 读取 assistants 配置
2. 如果 assistants 为空或不存在 → 跳过（不注册 summon tool，和现在一样）
3. ctx.modelRegistry.getAvailable() 获取所有已配置 API Key 的可用模型
4. 将 config 中的 model 字段与可用模型列表做比对
5. 全部有效 → 正常注册 summon tool
6. 有无效模型 → notify 警告 + 仍然注册（但只注册有效的助手，跳过无效的）
```

### 模型匹配方式

config 里的 model 字段格式是 `provider/id`（如 `minimax-cn/MiniMax-M2.7`）。

`ctx.modelRegistry.getAvailable()` 返回 `Model[]`，每个 Model 有：
- `model.provider`: `"anthropic"`, `"openai"`, `"minimax-cn"` 等
- `model.id`: `"claude-sonnet-4-5"`, `"MiniMax-M2.7"` 等

匹配方式：`model.provider + "/" + model.id`

### 伪代码

```typescript
// index.ts — 在 session_start 中增加校验
pi.on("session_start", async (_event, ctx) => {
  // ... 现有的 readiness file 逻辑不变 ...

  const config = loadConfig();
  if (!config.assistants?.length) return;

  const available = ctx.modelRegistry.getAvailable();
  const validModelIds = new Set(available.map(m => `${m.provider}/${m.id}`));

  const invalidAssistants = config.assistants.filter(a => !validModelIds.has(a.model));
  if (invalidAssistants.length > 0) {
    const names = invalidAssistants.map(a => `${a.alias}(${a.model})`).join(', ');
    ctx.ui.notify(
      `⚠️ 助手模型无效: ${names}。运行 /summon-setup 重新配置。`,
      'warning'
    );
  }
});
```

### registerSummonTool 改动

注册 summon tool 时，过滤掉无效助手：

```typescript
const validAssistants = config.assistants.filter(a => validModelIds.has(a.model));
// 用 validAssistants 注册，而非 config.assistants
```

这样无效助手的 alias 不会出现在 tool 参数的 enum 里，LLM 不会尝试召唤它。

---

## B. `/summon-setup` 向导命令

详细实现计划见 `plan-summon-setup.md`。

交互流程：SelectList overlay 弹窗显示所有可用 model，选一个 → input 起名字 → 回到列表（标 ✓）→ Esc 保存退出。

---

## 实现顺序

| 阶段 | 内容 | 状态 |
|------|------|------|
| 1 | C — 用户级配置路径 | ✅ 已完成 |
| 2 | B — `/summon-setup` 向导 | |
| 3 | A — 初始化校验 + summon tool 过滤 | |

## 文件改动清单

| 文件 | 改动 | 状态 |
|------|------|------|
| `config.ts` | 用户级配置加载 + `saveConfig` + 缓存清除 | ✅ 已完成 |
| 新文件 `pane-comm/summon-setup.ts` | `/summon-setup` 命令实现 | |
| `index.ts` | 注册 `/summon-setup` 命令 + `session_start` 模型校验 | |
| `pane-comm/summon.ts` | 注册时过滤无效助手 | |
