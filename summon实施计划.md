# Summon Tool 实施计划

基于 `summon评估.md` 的分析结论，本计划将实施拆解为 5 个步骤，按依赖顺序排列。每步完成后可独立验证，无前后耦合的步骤可并行。

---

## 修改概览

| 文件 | 操作 | 改动量 | 说明 |
|------|------|--------|------|
| `config.ts` | 修改 | ~10 行 | 新增 `AssistantConfig` 接口 |
| `pane-comm/msg-protocol.ts` | 修改 | ~20 行 | `PiMessage` 加 `assistant` 字段、`buildMessage`/`parseMessage` 支持 `<assistant>` 标签 |
| `pane-comm/summon.ts` | **新增** | ~70 行 | summon tool 定义 + execute 逻辑（复用已有 `callWorker`） |
| `pane-comm/interceptor.ts` | 修改 | ~15 行 | input hook 中增加 `commType === 'Summon'` 独立分支 |
| `index.ts` | 修改 | ~5 行 | 条件注册 summon |
| `config.json` | 修改 | ~5 行 | 加 `assistants` 配置 |

> **注：** `callWorker.ts` 已在之前的重构中实现（创建 pane → 等待就绪 → 占位符替换 → 写入消息），summon 直接复用，无需额外改动。`delegates.ts` 不需要修改（`sendDelegate` 已被 `callWorker` 替代，`delegateMsgMaker` 保留给 dd/dc 使用）。

**总改动量：约 120-130 行**。

---

## Step 1: config.ts — 新增 AssistantConfig 接口

**依赖：无**

**改动内容：**

在 `config.ts` 中新增：

```typescript
export interface AssistantConfig {
  alias: string;
  model: string;
}
```

在 `PaneCommConfig` 接口中新增可选字段：

```typescript
export interface PaneCommConfig {
  // ...existing fields...
  assistants?: AssistantConfig[];  // 新增
}
```

**验证：** 编译无报错，现有 `/dd`、`/dc` 功能不受影响。

---

## Step 2: msg-protocol.ts — 协议层支持 `<assistant>` 字段

**依赖：无（可与 Step 1 并行）**

**改动内容：**

### 2.1 PiMessage 接口

在 `PiMessage` 接口中新增：

```typescript
export interface PiMessage {
  // ...existing fields...
  assistant?: string;   // 新增：summon 专用，assistant alias
}
```

### 2.2 parseMessage

在 `parseMessage` 函数中解析 `<assistant>` 标签：

```typescript
const assistant = extractField(input, 'assistant');
// ...
return {
  // ...existing fields...
  assistant: assistant || undefined,
};
```

### 2.3 buildMessage

给 `buildMessage` 增加 `assistant` 参数，**放在参数列表最末尾**（`firstPid` 之后），并输出 `<assistant>` 标签：

```typescript
export function buildMessage(
  firstPaneId: string,
  secondPaneId: string,
  firstName: string,
  secondName: string,
  needReply: boolean,
  commId: string,
  commType: string,
  markdown: string,
  agent: string | undefined = undefined,
  firstPid: number | undefined = undefined,
  assistant: string | undefined = undefined,      // ← 新增，放最后（第11位）
): string {
  // ...existing lines...
  const assistantLine = assistant !== undefined
    ? `    <assistant: ${assistant}>`
    : `    <assistant: >`;
  // 在 firstPidLine 之后、<markdown> 之前插入 assistantLine
}
```

**⚠️ 向后兼容保证：** `assistant` 参数有默认值 `undefined`，现有所有调用点（`dd.ts`、`dc.ts`、`interceptor.ts` 的 `agent_end` 回复）都不传此参数，不需要任何修改。

**验证：**
- 现有 `/dd`、`/dc` 的消息构建和解析正常
- 手动构造含 `<assistant: Lisa>` 的 XML 消息，验证 `parseMessage` 能正确解析

---

## Step 3: summon.ts — summon tool 定义（新文件）

**依赖：Step 1（AssistantConfig）、Step 2（buildMessage 带 assistant）**

这是核心新增文件。遵循与 `dd.ts` / `dc.ts` 相同的模式：自己拼 cmd + msg，调用 `callWorker`。

**为什么不抽取 `spawnWorker`：** `delegates.ts` 的 `delegateMsgMaker` 绑定了 `config.names.worker` 和 `agent` 字段，而 Summon 需要动态 `secondName`（用 assistant alias）和 `assistant` 字段，两者消息构造逻辑不同。与其强行抽象出共享函数再传一堆差异化参数，不如各自拼装——与 dd/dc 同模式，更简单直接。

**改动内容：**

### 3.1 导入

```typescript
import { Type } from 'typebox';
import { StringEnum } from '@earendil-works/pi-ai';  // pi 扩展标准导入，见 pi docs extensions.md
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { loadConfig } from '../config';
import { getMyPaneId } from '../lib/zellij';
import { generateCommId, buildMessage } from './msg-protocol';
import { callWorker } from './callWorker';
```

> **`StringEnum` 说明：** 来自 `@earendil-works/pi-ai`，是 pi 扩展文档中推荐的标准方式（所有 enum 参数工具示例均使用此导入）。必须用 `StringEnum` 而非 TypeBox 原生的 `Type.Union`/`Type.Literal`，后者不兼容 Google API。

### 3.2 registerSummonTool 函数

```typescript
export function registerSummonTool(pi: ExtensionAPI) {
  const config = loadConfig();
  const assistants = config.assistants ?? [];
  const aliases = assistants.map(a => a.alias);

  if (aliases.length === 0) return;  // 安全检查

  pi.registerTool({
    name: "summon",
    label: "Summon Assistant",
    description: "召唤一个助手到 floating pane 执行任务。只在用户明确提到助手名字时使用。",
    parameters: Type.Object({
      assistant: StringEnum(aliases as [string, ...string[]], {
        description: "助手别名，仅在用户明确提及时使用"
      }),
      task: Type.String({ description: "要执行的任务描述" }),
    }),
    promptSnippet: "召唤指定助手到 floating pane 执行任务",
    promptGuidelines: [
      "只在用户明确提到助手名字时使用 summon 工具。",
      "使用 summon 时，根据对话上下文起草一个完整清晰的 task prompt。",
    ],
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const { assistant, task } = params;
      const config = loadConfig();
      const found = config.assistants?.find(a => a.alias === assistant);

      if (!found) {
        return {
          content: [{ type: "text", text: `错误：找不到助手 "${assistant}"。请检查 config.json 中的 assistants 配置。` }],
        };
      }

      // 拼 cmd（与 dd.ts 同模式，但用 assistant 的 model）
      let cmd = 'pi';
      cmd += ` --model ${found.model}`;
      if (config.mode && config.mode !== 'plan') cmd += ` --agentMode ${config.mode}`;

      // 拼 msg（secondPaneId 用占位符，callWorker 会替换为真实 ID）
      const message = buildMessage(
        getMyPaneId(),            // firstPaneId
        '__WORKER_PANE_ID__',     // secondPaneId 占位符
        config.names.main,        // firstName
        found.alias,              // secondName
        true,                     // needReply
        generateCommId(),         // commId
        'Summon',                 // commType
        task,                     // markdown
        undefined,                // agent（summon 不指定 agent）
        process.pid,              // firstPid
        found.alias,              // assistant（新字段，Step 2 新增）
      );

      try {
        const workerPaneId = await callWorker(cmd, message, found.alias);

        return {
          content: [{ type: "text", text: `✓ 已召唤 ${found.alias}（模型: ${found.model}）到 pane ${workerPaneId} 执行任务。` }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `召唤 ${found.alias} 失败：${err.message}` }],
        };
      }
    },
  });
}
```

### 3.3 关键设计点

1. **与 dd/dc 同模式** — 自己拼 cmd + msg，调用 `callWorker`，不经过 `delegateMsgMaker` 或 `delegates.ts`
2. **StringEnum 动态值** — `aliases` 来自 config，不硬编码
3. **消息构造独立** — 用 `commType: 'Summon'` 和 `assistant` 字段，不走 `delegateMsgMaker()`
4. **错误处理返回结构化结果** — 不 throw，让 LLM 理解错误并生成友好回复
5. **geometryKey 用 alias** — 每个 assistant 窗口位置独立记忆（通过 `callWorker` 的 `workerName` 参数）
6. **model 走 --model 参数** — 直接拼入 cmd 字符串

**验证：**
- 在 pi 中说 "让 Lisa 帮我搜索一下"，确认 Main LLM 调用 summon 工具
- 确认 floating pane 创建、消息发送正常
- 确认不提助手名时 LLM 不调用 summon

---

## Step 4: interceptor.ts — Summon 独立分支

**依赖：Step 2（parseMessage 能解析 assistant 字段）**

**改动内容：**

在 input hook 中，现有逻辑之前插入 Summon 分支：

```typescript
// 在 message 解析之后、agent 处理之前
if (message.commType === 'Summon') {
  // Summon 独立分支
  const fromName = message.firstName;
  const assistant = message.assistant;
  
  ctx.ui.notify(`📨 收到来自 ${fromName} 的召唤（${assistant}）`, 'info');
  
  currTask = {
    firstPaneId: message.firstPaneId,
    secondPaneId: message.secondPaneId,
    firstName: message.firstName,
    secondName: message.secondName,
    needReply: message.needReply,
    commId: message.commId,
    commType: message.commType,
    assistant: message.assistant,
    firstPid: message.firstPid,
    receivedAt: Date.now(),
  };

  pi.sendUserMessage(`[来自 ${fromName} 的召唤（${assistant}）]\n${message.markdown}`);
  return { action: 'handled' };
}

// 原有 Delegate / Report / Chat 逻辑继续...
```

**设计决策：**
- Summon 分支**不处理 agent**（不调用 `readAgent`），因为 summon 消息不含 agent
- `currTask` 的结构不变，`agent_end` 的回复+关闭流程完全复用
- 分支独立，以后可以独立演进（多轮交互、结果摘要等）

**验证：**
- Worker 收到 Summon 消息后正常执行
- 执行完成后 `agent_end` 正确回复 Main 并关闭 pane
- `/dd`、`/dc` 流程不受影响

---

## Step 5: index.ts — 条件注册 + config.json 示例

**依赖：Step 4（registerSummonTool 函数）**

**改动内容：**

### 5.1 index.ts

```typescript
import { registerSummonTool } from './pane-comm/summon';

export default function (pi: ExtensionAPI) {
  if (!process.env.ZELLIJ) return;

  registerEditorShortcut(pi);
  registerDcCommand(pi);
  registerDdCommand(pi);
  registerInterceptor(pi);

  // 有 assistants 配置时才注册 summon tool
  const config = loadConfig();
  if (config.assistants?.length) {
    registerSummonTool(pi);
  }
}
```

### 5.2 config.json — 新增 assistants 字段

在包内默认 config.json 中新增 `assistants` 数组：

```json
{
  "names": {
    "main": "Main",
    "worker": "Lisa"
  },
  "assistants": [
    { "alias": "Lisa", "model": "minimax-cn/MiniMax-M2.7:medium" },
    { "alias": "Jackey", "model": "zai/glm-5.1:high" }
  ],
  ...其余字段不变
}
```

**验证：**
- 无 `assistants` 配置时，summon tool 不注册，LLM 看不到
- 有配置时，summon tool 正常注册并可用
- 现有所有功能（editor、/dd、/dc）不受影响

---

## 实施顺序与并行策略

```
Step 1 (config.ts)  ──┐
                       ├── Step 3 (summon.ts) ── Step 5 (index.ts)
Step 2 (msg-protocol) ─┤
Step 4 (interceptor.ts) ┘
```

- **Step 1 + Step 2** 可并行
- **Step 3** 依赖 Step 1 + 2，复用已有 `callWorker.ts`
- **Step 4** 依赖 Step 2
- **Step 5** 依赖 Step 3

**建议实施顺序：** 1 → 2 → 3 → 4 → 5（线性，最安全）

---

## 测试检查清单

### 基本功能
- [ ] 无 `assistants` 配置时，`/dd`、`/dc` 功能完全正常
- [ ] 有 `assistants` 配置时，`/dd`、`/dc` 功能完全正常
- [ ] 说 "让 Lisa 做XXX"，Main LLM 调用 summon 工具
- [ ] summon 创建 floating pane，worker 启动并执行任务
- [ ] worker 完成后自动回复 Main 并关闭 pane

### 触发控制
- [ ] 不提助手名字时，LLM 不调用 summon
- [ ] 提到助手名字时，LLM 调用 summon 且 `assistant` 参数正确
- [ ] config 中不存在的 alias，LLM 无法填入（StringEnum 拦截）

### 多 Worker
- [ ] 同时 summon 两个不同 assistant（如 Lisa + Jackey），各自独立 pane
- [ ] 两个 assistant 的 geometry 各自记忆，互不干扰
- [ ] 多 Summon 同时存在时，各自的 `agent_end` 回复正确路由到各自的发起方

### 错误处理
- [ ] assistant 的 model 写错时，floating pane 显示错误信息，不崩溃
- [ ] zellij 不在运行时，summon 返回错误而非崩溃

### 协议兼容
- [ ] Delegate 消息（`/dd`、`/dc`）的 `<agent>` 字段正常
- [ ] Summon 消息的 `<assistant>` 字段正常
- [ ] 两种消息在 worker 侧各自走独立分支

---

## 后续增强方向（不在本次 MVP 范围）

1. **对话式召唤** — Worker 不自动关闭，支持 Main 和 Worker 多轮交互
2. **结果摘要** — Main LLM 收到 Worker 回复后，自动生成简洁摘要
3. **Agent 继承** — summon 时也能指定 agent（结合 `summon` + agent 的能力）
4. **自动委派** — Main LLM 不仅在用户提到助手名时调用，还能主动判断任务适合委派

