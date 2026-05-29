# summon 工具评估

## 一句话结论

**这个想法非常好，而且技术上几乎已经 ready。** 核心基础设施（pane 管理、协议通信、worker 生命周期）全部已经在 `delegates.ts` + `interceptor.ts` 中实现。你只需要做一个薄薄的 "tool 壳" 把它们暴露给 LLM。

---

## 一、可行性分析

### 1.1 registerTool 完全支持

pi 的 `pi.registerTool()` API 正是为了这种场景设计的——给 LLM 一个它可以自主调用的工具。你只需要：

```typescript
const config = loadConfig();
const aliases = (config.assistants ?? []).map(a => a.alias);

pi.registerTool({
  name: "summon",
  label: "Summon Assistant",
  description: "召唤一个助手到 floating pane 执行任务。只在用户明确提到助手名字时使用。",
  parameters: Type.Object({
    assistant: StringEnum(aliases, {
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
    // 查 alias → 取 model → sendDelegate(overrideModel)
  },
});
```

### 1.2 现有代码复用度极高

| 需要的功能 | 现有模块 | 复用情况 |
|---|---|---|
| 创建 floating pane | `lib/zellij.ts` → `createFloatingPane()` | ✅ 直接用 |
| 等待 worker 就绪 | `delegates.ts` → readiness file 轮询 | ✅ 直接用 |
| 构建协议消息 | `msg-protocol.ts` → `buildMessage()` | ✅ 直接用 |
| 发送消息到 pane | `lib/zellij.ts` → `writeToPane()` | ✅ 直接用 |
| Worker 接收 + 回复 | `interceptor.ts` | ✅ 几乎不用改 |
| Worker 完成后关闭 | `interceptor.ts` → `agent_end` | ✅ 已有 |

**结论：底层步骤（create pane、wait ready、write）已经就绪。** summon 只需要自己构造消息，然后调用共用的 `spawnWorker()`。

### 1.3 commType 区分也是现成的

协议里 `commType` 字段已经支持任意字符串。当前用了 `Delegate` 和 `Report`，加一个 `Summon` 完全没问题，解析端不需要改。

---

## 二、需要改动的地方

### 2.1 config.json — 加 assistants 数组

```json
{
  "names": { "main": "Main", "worker": "Lisa" },
  "assistants": [
    { "alias": "Lisa", "model": "minimax-cn/MiniMax-M2.7:medium" },
    { "alias": "Jackey", "model": "zai/glm-5.1:high" }
  ],
  "workerPane": { ... },
  "models": "minimax-cn/MiniMax-M2.7",
  "mode": "work"
}
```

`names.worker` 是给 `/dd` 和 `/dc` 用的，`assistants` 是给 summon 用的。两者互相不干扰、互相隔离，不需要兼容或 fallback 逻辑。

### 2.2 新增 `pane-comm/summon.ts` — summon tool 定义

summon 自己构造消息，不借用 `delegateMsgMaker()`（那个是 Delegate 专用的，用 `config.names.worker` 和 `<agent>` 字段）。summon 用 `config.assistants` 和 `<assistant>` 字段，各自干净。

底层步骤（create pane、wait ready、write）从 `sendDelegate()` 抽取为共用函数，delegate 和 summon 各自调用。

核心 execute 逻辑（伪代码）：

```typescript
async execute(toolCallId, params, signal, onUpdate, ctx) {
  const { assistant, task } = params;
  const config = loadConfig();
  
  // 查找 assistant
  const found = config.assistants?.find(a => a.alias === assistant);
  if (!found) { /* 返回结构化错误 */ }
  
  // 校验 model
  const [provider, id] = found.model.split('/');
  const model = ctx.modelRegistry.find(provider, id);
  if (!model) { /* 返回结构化错误 */ }
  
  // summon 自己构造消息（不经过 delegateMsgMaker）
  const msg = {
    firstPaneId: getMyPaneId(),
    secondPaneId: '',  // spawnWorker 后填入
    firstName: config.names.main,
    secondName: found.alias,       // "Lisa" — 和 Delegate 统一，表示发给谁
    needReply: true,
    commId: generateCommId(),
    commType: 'Summon',
    agent: '',                      // 空，不是 undefined
    assistant: found.alias,         // summon 专用字段
    markdown: task,
    firstPid: process.pid,
  };
  
  // 调用共用的底层函数：create pane + wait ready + write
  await spawnWorker(ctx, msg, {
    model: found.model,
    geometryKey: found.alias,  // "Lisa"、"Jackey"
    title: found.alias,
  });
}
```

### 2.3 interceptor.ts — 独立分支处理 Summon

**必须另写独立分支**。Summon 以后会发展出更多玩法（多轮交互、结果摘要、对话式协作等），和 Delegate 的差异只会越来越大。现在不分，以后想分的时候改动面就大了。

协议层是同一套 `parseMessage`，但按 `commType` 各读各的字段：
- `Delegate` → 读 `<agent>`，不管 `<assistant>`
- `Summon` → 读 `<assistant>`，不管 `<agent>`

```typescript
// input hook 里
if (message.commType === 'Summon') {
  // Summon 专用分支，独立演进
  const fromName = message.firstName;
  const assistant = message.assistant;  // 读 <assistant>，不碰 <agent>
  ctx.ui.notify(`📨 收到来自 ${fromName} 的召唤`, 'info');
  // ... 独立流程
} else {
  // 原有 Delegate / Report / Chat 逻辑
}
```

### 2.4 config.ts — 接口扩展

```typescript
export interface AssistantConfig {
  alias: string;
  model: string;
}

export interface PaneCommConfig {
  // ...existing fields...
  assistants?: AssistantConfig[];  // 新增
}
```

### 2.5 index.ts — 条件注册 summon

根据 `config.json` 是否有 `assistants` 配置来决定是否注册 summon tool。没配就不注册，LLM 完全看不到这个工具。

```typescript
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

---

## 三、设计亮点

### 3.1 两层 LLM 各司其职，这是最优雅的地方

- **Main LLM（贵模型）**：理解用户意图 → 整理上下文 → 起草 task prompt → 调用 summon tool
- **Worker LLM（便宜模型）**：接收 task → 用指定 model 执行 → 返回结果

用户只需要说"让 Lisa 搜索一下相关资料"，Main LLM 就会自动：
1. 理解"搜索相关资料"指什么（从对话上下文推断）
2. 起草一段具体的 prompt 给 Lisa
3. 调用 summon 工具

**这比 `/dd Lisa 搜索相关资料` 好太多了**——因为 Main LLM 可以把对话中的隐含上下文写进 task prompt。

### 3.2 比现有 /dd 的优势

| | `/dd` | `summon` tool |
|---|---|---|
| 谁决定委派？ | 用户手动 | Main LLM 自主决定 |
| prompt 质量 | 用户自己写 | Main LLM 根据上下文起草 |
| 用户体验 | 要打命令 | 自然语言说一句就行 |
| 模型选择 | 统一 config | 每个 assistant 独立 model |

### 3.3 向后兼容

- `/dd` 和 `/dc` 完全不受影响
- 没有 `assistants` 配置 → summon tool 根本不注册 → LLM 看不到这个工具 → 零副作用
- `commType: 'Summon'` 和 `commType: 'Delegate'` 在 worker 侧有各自独立分支，协议层同一套但各读各的字段

---

## 3.4 审阅回应（Lisa Review）

以下是对代码审阅意见的逐条回应：

### 已确认 & 需要修正的问题

**`fromName` 语义正确，但 notify 描述应更明确**

Lisa 提到 `message.firstName` 是 Main 的名字不是 assistant alias。这确实需要明确——但协议里 `firstName` 就是发送方（Main）的名字，这是对的。真正需要改的是 notify 内容，应该同时显示 commType 和来源：
```typescript
ctx.ui.notify(`📨 收到来自 ${fromName} 的召唤 (给 ${message.secondName})`, 'info');
```

**geometryKey 用 alias 完全安全**

`createFloatingPane` 的 `geometryKey` 是 geometry 文件里的存储 key（格式 `[Lisa] x:10, y:20, w:40, h:70`），不同 alias = 不同 key = 不同位置记录，不会互相覆盖。

**`workerPane` 配置直接复用**

summon 和 `/dd`/`/dc` 共用 `workerPane` 的 `width`/`height` 作为默认尺寸。没有 `workerPane` 配置时用 zellij 默认值。不需要额外配置。

**config 只在启动时读取一次**

当前 `loadConfig()` 是同步读文件，每次调用都重新读。但 tool 注册只在 `index.ts` 初始化时执行一次，运行时改 config 不会更新已注册的 tool schema。这是预期行为——和 pi 本身的 config 语义一致。

### 已排除的误报

**execute 签名正确**

pi SDK 的 `ToolDefinition.execute` 签名就是 `(toolCallId, params, signal, onUpdate, ctx) => Promise<AgentToolResult>`，文档中的伪代码一致。

**`ctx.modelRegistry` 在 tool execute 中可用**

`ExtensionContext` 接口确认包含 `modelRegistry: ModelRegistry`，tool execute 的 `ctx` 就是 `ExtensionContext`。

**readiness 文件无竞态**

readiness 文件名是 `pi-in-zellij-ready-${workerPaneId}`，`workerPaneId` 是 zellij 动态分配的唯一 ID（如 `terminal_42`），不同 worker 一定不同，不存在竞态。geometryKey 只影响窗口位置记忆，和 readiness 无关。

### 已采纳的建议

**reply 路由不需要 Main 侧额外处理**：每个 worker 是独立 pi 进程，各自的 `currTask` 单例各自追踪，reply 直接发给 Main pane，不会串。Main 侧 interceptor 收到 Report 时走现有逻辑即可。

**promptSnippet 强调前置条件**：已更新为"只在用户明确提到助手名字时使用 summon 工具"。

**错误消息规范化**：建议 execute 返回结构化的 `AgentToolResult` 而非 throw，让 LLM 能理解并生成友好回复。

**协议 `agent` 字段和 summon 无关**：summon 用独立的 `<assistant>` 字段，不复用 `<agent>`。已在 4.4 中明确。

---

## 四、需要注意的风险/难点

### 4.1 触发控制：StringEnum 双重锁定（关键！）

LLM 无法可靠地判断"何时该委派"，但**完全可以可靠地判断"用户有没有提到某个名字"**。

所以规则很简单：
- 用户明确说了 Lisa/Jackey → Main LLM 使用 summon
- 用户没说任何 assistant alias → Main LLM 不允许使用 summon

实现上用 **StringEnum** 做 `assistant` 参数，双重锁定：

1. **Schema 层**：`assistant` 只能填 config 中定义的 alias。用户没提到名字 → LLM 没有合法值可填 → 不会调用
2. **Description 层**：description 再强调"只在用户明确提到助手名字时使用"

即使 LLM 偶尔想"主动帮忙"，它也无法编造一个不在 enum 里的名字——schema 验证会直接拦住。

```typescript
parameters: Type.Object({
  assistant: StringEnum(["Lisa", "Jackey"] as const, {
    description: "助手别名，仅在用户明确提及时使用"
  }),
  task: Type.String({ description: "要执行的任务" }),
}),
```

**⚠️ 绝对不能硬编码 alias 列表。** 不同用户喜欢的名字和模型完全不一样。
StringEnum 的值必须从 config 动态生成：

```typescript
const config = loadConfig();
const aliases = (config.assistants ?? []).map(a => a.alias);
// 如果用户没配 assistants → aliases 为空 → enum 为空 → 工具形同不存在

pi.registerTool({
  name: "summon",
  parameters: Type.Object({
    assistant: StringEnum(aliases, {
      description: "助手别名，仅在用户明确提及时使用"
    }),
    task: Type.String({ description: "要执行的任务" }),
  }),
  // ...
});
```

这样做到：
- 有 `assistants` 配置 → 工具可用，enum 值来自用户自己的配置
- 没有 `assistants` 配置 → aliases 为空数组 → enum 为空 → LLM 无法调用 → 零副作用
- 用户改名、加人、换模型 → 只改 config.json，不用动代码

### 4.2 Model 由 Main 侧通过 `--model` 指定

pi 虽然有 `pi.setModel()` API 让 worker 侧自己切 model，但 **main 侧在启动 worker 时直接传 `--model` 更合适**：

- 更快：worker 启动完直接干活，不用多一步切换
- `/dd` 和 `/dc` 现有代码已经在这么做了，summon 也这样做，逻辑一致

底层 `spawnWorker()` 接收 model 参数，delegate 传 `config.models`，summon 传 `assistants[].model`，互不干扰：

```typescript
// delegates.ts 内部
async function spawnWorker(
  ctx: ExtensionContext,
  msg: PiMessage,
  opts: { model?: string; geometryKey?: string; title?: string; contextFile?: string }
): Promise<void> {
  const config = loadConfig();
  const cmd = ['pi'];
  if (opts.contextFile) cmd.push('--fork', opts.contextFile);
  if (opts.model || config.models) cmd.push('--model', opts.model || config.models);
  if (config.mode && config.mode !== 'plan') cmd.push('--agentMode', config.mode);
  // ... createFloatingPane, wait ready, write
}

// sendDelegate 调用 spawnWorker
export async function sendDelegate(ctx, msg, contextFile?) {
  await spawnWorker(ctx, msg, {
    model: undefined,  // 用 config.models
    geometryKey: 'worker',
    title: config.names.worker,
    contextFile,
  });
}
```

这样 `/dd`、`/dc` 完全不用动，summon 调用 `spawnWorker` 传入 assistant 的 model。

### 4.3 多 worker 同时存在

如果用户说"让 Lisa 做A，让 Jackey 做B"，两个 floating pane 会同时存在。当前 interceptor 的 `currTask` 是单例，一个 worker 只能追踪一个任务——这没问题，因为每个 worker 是独立的 pi 进程，各自有自己的 `currTask`。

但 Main 端需要注意：两个 pane 可能重叠。**解决方案：每个 assistant 直接用自己的 alias 作为 geometryKey**（如 `Lisa`、`Jackey`），这样：
- 每个 assistant 的窗口位置独立记忆
- 用户拖拽调整后，下次召唤同一个 assistant 恢复到上次位置
- 不同 assistant 可以放在屏幕不同区域，互不遮挡

### 4.4 协议新增 `<assistant>` 字段

summon 不复用 `<agent>` 字段，而是新增独立的 `<assistant>` 字段传 alias。语义清晰，维护不混淆：

- `<agent>` — agent 文件名（如 `code-reviewer`），仅 Delegate 使用
- `<assistant>` — assistant alias（如 `Lisa`），仅 Summon 使用

```xml
<pi-communication>
    <firstPaneId: terminal_1>
    <secondPaneId: terminal_42>
    <firstName: Main>
    <secondName: Lisa>
    <needReply: true>
    <commId: 345678>
    <commType: Summon>
    <agent: >
    <assistant: Lisa>
    <firstPid: 12345>
    <markdown>
        搜索一下项目中所有与 auth 相关的代码...
    </markdown>
</pi-communication>
```

### 4.5 Worker 窗口标题

不需要特别处理。summon 消息里 `secondName` 就是 assistant alias（如 `Lisa`），`spawnWorker` 直接用 `msg.secondName` 做 pane title，和 Delegate 的逻辑完全一样。

### 4.6 错误处理：assistant 的 model 不存在

如果 config 里 assistant 的 model 写错了，`spawnWorker` 会正常创建 floating pane 并启动 `pi --model <错误模型>`。pi 启动失败，错误信息显示在 floating pane 里。readiness 文件不会写入，Main 侧超时后发送的消息没有意义，但 floating pane **不会自动关闭**，用户能看到错误信息，自己去改 config。不需要额外处理。

### 4.7 Token 开销

summon tool 的 schema + description 会占用 Main LLM 的 system prompt token。如果 assistant 列表很长，可以考虑只列出常用的。但对大多数用户来说 2-3 个 assistant，开销可以忽略。

---

## 五、实现建议

### 5.1 最小可行实现（MVP）

改动量估计：**约 100-150 行新代码 + 小幅修改 delegates.ts 和 config.ts**

1. `config.ts` — 加 `AssistantConfig` 接口
2. `config.json` — 加 `assistants` 数组
4. `pane-comm/delegates.ts` — 抽取底层步骤为 `spawnWorker()`，`sendDelegate` 改为调用它
5. `pane-comm/summon.ts` — 新文件，自己构造消息，调用 `spawnWorker()`
5. `index.ts` — 条件注册 summon（`if (config.assistants?.length)`）
6. `pane-comm/msg-protocol.ts` — `PiMessage` 接口加 `assistant?` 字段，`buildMessage`/`parseMessage` 支持新标签

### 5.2 可以渐进增强的方向

- **自动委派**：Main LLM 不仅在用户提到助手名时调用，还能主动判断任务适合委派
- **对话式召唤**：worker 不用关闭，保持 floating pane 和 Main 之间可以多轮交互
- **结果摘要**：Main LLM 收到 worker 回复后，自动摘要给用户
- **Agent 继承**：summon 时也能指定 agent（`/dd code-reviewer` 的能力带入 summon）

---

## 六、总结

| 维度 | 评分 | 说明 |
|---|---|---|
| **创意** | ⭐⭐⭐⭐⭐ | 让 Pi 从"被动等用户指令"变成"主动编排多助手" |
| **可行性** | ⭐⭐⭐⭐⭐ | 90% 基础设施已存在，registerTool API 完美适配 |
| **改动量** | ⭐⭐⭐⭐⭐ | ~100-150 行新代码，复用 sendDelegate |
| **用户体验** | ⭐⭐⭐⭐⭐ | 从打命令到自然语言，质的飞跃 |
| **风险** | ⭐⭐⭐⭐ | 风险低，向后兼容，唯一要注意的是 tool description 调教 |

**非常值得做，而且可以很快做出来。**
