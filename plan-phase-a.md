# Plan: Phase A — 初始化时校验模型有效性

## 目标

session 启动时校验 config 中的 assistants 模型是否在当前可用模型列表里。无效的模型 warn 用户，且不注册为 summon tool 的参数。

## 改动范围

| 文件 | 改动 |
|------|------|
| `index.ts` | session_start 中加校验 + 只传有效 assistants 给 registerSummonTool |
| `pane-comm/summon.ts` | `registerSummonTool` 改为接收 `validAssistants` 参数 |

## 实现细节

### `index.ts`

当前逻辑：
```typescript
const config = loadConfig();
if (config.assistants?.length) {
  registerSummonTool(pi);
}
```

改为（新 session_start handler，与 worker readiness handler 独立）：
```typescript
pi.on('session_start', async (_event, ctx) => {
  if (process.env.PI_FLOATING_WORKER) return;  // 只在 main pane 执行

  const config = loadConfig();
  const assistantList = [...(config.assistants ?? [])];
  let assReady = true;

  if (assistantList.length === 0) {
    assReady = false;
  } else {
    const available = ctx.modelRegistry.getAvailable();
    const validModelIds = new Set(available.map(m => `${m.provider}/${m.id}`));

    const toDelete: typeof assistantList = [];
    for (let i = assistantList.length - 1; i >= 0; i--) {
      if (!validModelIds.has(assistantList[i].model)) {
        toDelete.push(assistantList[i]);
        assistantList.splice(i, 1);
      }
    }

    if (toDelete.length > 0) {
      saveConfig({ assistants: assistantList });
      ctx.ui.notify(
        `⚠️ 已移除无效助手: ${toDelete.map(a => `${a.alias}(${a.model})`).join(', ')}`,
        'warning'
      );
    }

    if (assistantList.length === 0) {
      assReady = false;
    }
  }

  if (!assReady) {
    ctx.ui.notify(
      '⚠️ 尚未配置助手，请运行 /summon-setup 配置。',
      'warning'
    );
    return;
  }

  registerSummonTool(pi, assistantList);
});
```

同时**删除**原来的模块级注册代码：
```typescript
// 删除这段：
const config = loadConfig();
if (config.assistants?.length) {
  registerSummonTool(pi);
}
```

### `pane-comm/summon.ts`

当前签名：
```typescript
export function registerSummonTool(pi: ExtensionAPI) {
```

改为接收可选的预过滤列表，且 execute 回调用闭包变量：
```typescript
export function registerSummonTool(pi: ExtensionAPI, assistantsOverride?: AssistantConfig[]) {
  const config = loadConfig();
  const assistants = assistantsOverride ?? config.assistants ?? [];
  // ... aliases 等用 assistants 构建

  async execute(toolCallId, params, signal, onUpdate, ctx) {
    const { assistant, task } = params;
    // 用闭包中的 assistants，不再重新 loadConfig
    const found = assistants.find(a => a.alias === assistant);
    // ... 后续不变
  }
}
```

注意：execute 里原来有 `const config = loadConfig()` 和 `config.assistants?.find()`，需要改为用闭包中的 `assistants`。

### 模型匹配方式

config 里的 model 格式：`provider/id`（如 `minimax-cn/MiniMax-M2.7`）。

`ctx.modelRegistry.getAvailable()` 返回 `Model[]`，匹配：`m.provider + "/" + m.id`。

## 不改的地方

- `config.ts` — 不动
- `pane-comm/summon-setup.ts` — 不动
- `config.json` — 不动（已经是空 assistants）

## 校验触发时机

放在 `session_start` 而不是模块初始化阶段，因为：
- `ctx.modelRegistry` 只在 session 上下文里可用
- `ctx.ui.notify` 只在 session 上下文里可用

但 `registerSummonTool` 的调用也从模块初始化移到了 `session_start`，这意味着 summon tool 在 session 启动后才注册，而不是扩展加载时。

这应该没问题——pi 的 tool 注册时机本来就是 session 级别的。

## 两个 session_start handler

现在 `index.ts` 里已经有一个 `pi.on('session_start', ...)` 写 readiness file（只在 worker 里跑，不需要 ctx）。新的校验逻辑只在 main pane 里跑（需要 ctx）。

**保持两个独立的 `pi.on` 调用**，不要合并：
- worker handler：不需要 ctx，用 `PI_FLOATING_WORKER` 判断
- main handler：需要 ctx，用 `!PI_FLOATING_WORKER` 排除

两者互斥，各自清晰。
