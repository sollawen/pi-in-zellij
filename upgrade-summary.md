# pi-in-zellij 升级实施总结

**版本：** 0.3.0（callWorker 重构 + summon 功能）  
**日期：** 2026-05-29  
**撰写：** Jackey

---

## 一、整体过程回顾

这次升级包含两个主要任务，按顺序完成：

### 任务 1：callWorker 重构

**目标：** 从 `delegates.ts` 中提取 pane 创建 + ready 等待 + 写入逻辑，形成独立的 `callWorker.ts`。

**改动范围：**

| 文件 | 操作 | 说明 |
|------|------|------|
| `callWorker.ts` | **新建** | 核心函数：创建 pane → 等待就绪 → 占位符替换 → 写入消息 |
| `dd.ts` | 改写 | handler 中自己拼 cmd + msg，直接调用 `callWorker` |
| `dc.ts` | 改写 | 同 dd.ts 模式，cmd 多加 `--fork` |
| `delegates.ts` | 精简 | 删除 `sendDelegate()`，仅保留 `delegateMsgMaker()` |
| `zellij.ts` | 微调 | `createFloatingPane` 的 `cmd` 参数从 `string[]` 改为 `string` |

**过程中发现并修复的 Bug：** dd/dc 拼 msg 时 `workerPaneId` 尚不存在（pane 还没创建），导致 worker 收不到自己的 paneId，无法回传结果。用 `__WORKER_PANE_ID__` 占位符解决——调用方先填占位符，`callWorker` 创建 pane 拿到真实 ID 后做字符串替换。

### 任务 2：summon 功能

**目标：** 新增 `summon` tool，让 Main LLM 可以把指定助手（如 Lisa、Jackey）召唤到 floating pane 执行任务。

**改动范围：**

| 文件 | 操作 | 说明 |
|------|------|------|
| `config.ts` | 修改 | 新增 `AssistantConfig` 接口、`PaneCommConfig` 加 `assistants` 字段 |
| `msg-protocol.ts` | 修改 | `PiMessage` 加 `assistant` 字段、`buildMessage`/`parseMessage` 支持 `<assistant>` 标签 |
| `summon.ts` | **新建** | summon tool 定义 + execute 逻辑（复用 `callWorker`） |
| `interceptor.ts` | 修改 | input hook 新增 `commType === 'Summon'` 独立分支 |
| `index.ts` | 修改 | 条件注册：有 `assistants` 配置才注册 summon tool |
| `config.json` | 修改 | 新增 `assistants` 数组 |

**总改动量：** 约 150 行新增 + 50 行修改，涉及 8 个文件（含 2 个新建）。

---

## 二、做对了什么（经验）

### 1. 先重构、后新增——降低了第二阶段的复杂度

callWorker 重构是 summon 的前置依赖。如果不先做重构，summon 需要直接操作低层 zellij API，与 dd/dc 的逻辑大量重复。重构后 summon 只需拼 cmd + msg + 调 `callWorker`，70 行就完成了整个 tool 定义。

**教训：** 抽象层的提取应该在实际需要之前做——但更准确地说，是在"第二个消费者"出现时做。一个消费者不值得抽象，两个消费者时刚刚好。

### 2. 占位符方案简洁有效

`__WORKER_PANE_ID__` 占位符是一个纯字符串层面的解法，`callWorker` 不需要理解协议内容，只做 `msg.replace()`。这保持了 callWorker 的"不知道为什么，只管做什么"的职责边界。

### 3. 与现有模式保持一致而非强行抽象

dd、dc、summon 三者各自拼 cmd 和 msg，模式相同但代码独立。计划阶段曾考虑过抽一个 `spawnWorker` 之类的共享函数，最终放弃了——三者的差异（cmd 参数不同、msg 字段不同、commType 不同）会让共享函数需要接收大量参数，反而增加理解成本。独立拼装 + 共享 `callWorker` 是更清晰的选择。

### 4. 向后兼容设计

`buildMessage` 的 `assistant` 参数放在参数列表最末尾，带默认值 `undefined`。现有所有调用点（dd、dc、interceptor 的 agent_end 回复）都不需要改动。`parseMessage` 也对空 assistant 做了容错。这使得 summon 功能可以零风险地叠加到已有系统上。

### 5. 条件注册——summon 不是必选项

`index.ts` 中 `config.assistants?.length` 为空时不注册 summon tool。没有配置助手的用户完全不受影响，LLM 也看不到这个工具。这是"渐进式功能"的良好实践。

### 6. interceptor 中 Summon 分支独立

Summon 分支不处理 agent、不走 needReply 的复杂判断，而是直接设置 `currTask` 并 `sendUserMessage`。这让代码容易理解，也为将来独立演进（比如多轮交互）留出了空间。

---

## 三、踩了什么坑 / 不足（教训）

### 1. 先有鸡还是先有蛋——workerPaneId 的 Bug

这是整个过程中最大的坑。重构前 `sendDelegate` 是把 pane 创建和消息构造放在一起做的，pane ID 自然能在构造消息时使用。拆开后，消息构造在 pane 创建之前，`secondPaneId` 只能是空字符串。Worker 收到的消息里没有自己的 paneId，不知道该回传给谁，直接"失联"。

**根因：** 重构时没有充分追踪 `secondPaneId` 的数据依赖——它在 pane 创建后才产生，但在消息构造时就需要。拆分职责时割裂了这条依赖链。

**修复：** 占位符方案。虽然有效，但本质上是把一个运行时错误推迟到了字符串替换层面。如果有人不小心在 msg 里写了两处 `__WORKER_PANE_ID__`，replace 只会替换第一个。不过考虑到实际使用场景，这个风险很低。

**改进建议：** 重构时画出关键数据（如 pane ID）的生命周期，确认拆分后每一步都能拿到所需数据。

### 2. `createFloatingPane` 参数类型变更的影响范围

`cmd: string[]` → `cmd: string` 的改动看起来很小，但它影响了所有调用 `createFloatingPane` 的地方。如果项目继续扩展（比如 editor pane 也改用 `createFloatingPane`），需要确保所有调用方都传的是拼接好的字符串。

**改进建议：** 在函数签名变更时，用 TypeScript 编译器严格检查所有调用点，而不是靠人工排查。

### 3. summon 触发控制依赖 prompt engineering

summon tool 的"只在用户明确提到助手名字时使用"完全依赖 `promptGuidelines` 和 `description` 中的文字说明。LLM 有时仍然会在不合适的时候调用 summon（比如用户只是随口提到"Lisa"，并不是要委派任务）。这是所有 tool-based 触发控制的通病，不是代码层面能完全解决的。

**缓解措施：** 持续优化 tool description 和 promptGuidelines 的措辞；必要时可以在 execute 中加一层简单的语义检查。

### 4. 错误处理可以更细致

当前 summon execute 中，`callWorker` 的异常被 catch 后返回给 LLM 一条文本消息。但如果是 zellij 本身挂了（比如 `ZELLIJ` 环境变量存在但 zellij 进程已死），错误信息对 LLM 来说不够友好，可能尝试多次重试。

**改进建议：** 区分可恢复错误（网络抖动、临时资源不足）和不可恢复错误（zellij 不存在），给 LLM 更精确的反馈。

### 5. geometryKey 的语义略有偏移

`callWorker` 的 `workerName` 参数同时用作 pane title 和 `geometryKey`。dd/dc 传 `'worker'`（固定值），summon 传 assistant alias（如 `'Lisa'`）。这意味着 dd/dc 的窗口位置共享同一个 key，而 summon 的每个 assistant 有独立的位置记忆。这个行为虽然合理，但参数名叫 `workerName` 有误导性——它不只是 worker 的名字。

**改进建议：** 考虑将 `geometryKey` 和 `title` 分成独立参数，让语义更清晰。

---

## 四、对未来类似项目的建议

### 架构层面

1. **尽早识别"管道式"逻辑并提取**——像"创建 → 等待 → 写入"这种固定流程的，应该在第一个消费者（dd/dc）出现时就提取为独立函数，不必等到第二个消费者（summon）出现。

2. **占位符模式适用于"ID 在创建后才产生"的场景**——但要注意文档化这个约定，防止未来的维护者不知道 `__WORKER_PANE_ID__` 是什么。

3. **协议字段扩展时坚持向后兼容**——新字段带默认值、放参数列表末尾、parseMessage 对空值做容错。这让新功能可以逐步叠加，不需要一次性改完所有调用点。

4. **条件注册是好习惯**——不是所有用户都需要所有功能。通过 config 控制功能开关，减少不必要的影响范围。

### 流程层面

5. **重构时画出数据流**——特别是有"先创建后使用"模式的数据（如 pane ID），确保职责拆分后数据依赖不断裂。

6. **先验证重构，再叠加新功能**——这次先完成 callWorker 重构并验证 dd/dc 功能正常，再做 summon。如果在重构的同时开发新功能，出 Bug 时很难定位是重构的问题还是新功能的问题。

7. **实施计划写得很详细是值得的**——这次两个任务的实施计划都精确到了文件级别、代码级别，实际编码时几乎零偏差。投入在计划上的时间在实施阶段成倍回收。

### 代码风格

8. **同一个模式不要抽象，复制粘贴更好**——dd、dc、summon 三者的"拼 cmd + 拼 msg + 调 callWorker"模式相同但代码独立。当差异大于共性时，显式的重复比隐式的耦合更好维护。

9. **tool description 要写给 LLM 看**——summon 的 description 和 promptGuidelines 直接影响 LLM 的调用行为，措辞要像写 prompt 一样精心打磨，不能当作普通代码注释处理。

---

## 五、最终文件清单

```
pi-in-zellij/
├── index.ts                 # 入口，条件注册 summon
├── config.ts                # AssistantConfig 接口 + assistants 配置
├── config.json              # 含 assistants 数组的配置文件
├── pane-comm/
│   ├── callWorker.ts        # 新建：核心管道（创建 pane → 等待 → 替换 → 写入）
│   ├── summon.ts            # 新建：summon tool 定义 + execute
│   ├── dd.ts                # 改写：自行拼 cmd/msg，调 callWorker
│   ├── dc.ts                # 改写：同上，带 --fork
│   ├── delegates.ts         # 精简：删除 sendDelegate，保留 delegateMsgMaker
│   ├── msg-protocol.ts      # 修改：PiMessage 加 assistant，buildMessage/parseMessage 支持
│   └── interceptor.ts       # 修改：新增 Summon 独立分支
└── lib/
    └── zellij.ts            # 微调：createFloatingPane 参数类型
```

---

*总结完毕。这是一次结构清晰、风险可控的升级——重构和新功能解耦，向后兼容设计让现有功能零影响，callWorker 的提取为后续更多 worker 类型（如 scheduled task、watch mode 等）打下了基础。*
