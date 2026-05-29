# callWorker 重构实施计划

## 目标

从 `delegates.ts` 中提取 pane 创建 + ready 等待 + 写入逻辑，形成独立函数 `callWorker`。
dd.ts / dc.ts 自己拼装 cmd 和 msg 字符串，直接调用 `callWorker`。

## 职责划分

| 层 | 职责 | 不管的事 |
|----|------|----------|
| `dd.ts` / `dc.ts` | 拼装 cmd 字符串、拼装 msg 字符串、调用 callWorker | pane 怎么创建、ready 怎么等 |
| `callWorker.ts` | 创建 pane、等 ready、写入 msg | cmd 和 msg 是什么内容 |
| `createFloatingPane` | 执行 zellij 命令创建浮动 pane | cmd 是什么、pane 用来干嘛 |

## 已发现的 Bug 及修复方案

### Bug 1：位置/宽度错误

`callWorker` 传了 `workerName`（如 "Lisa"）作为 `geometryKey`，但旧数据存在 `[worker]` key 下。首次会使用 default 位置，关闭 pane 后会保存新位置，后续正常。不需要修复。

### Bug 2：worker 不退出、不回传结果

**根因**：dd/dc 拼 msg 时 `workerPaneId` 还不存在，只能传空字符串。worker 收到的消息里没有自己的 paneId，不知道该回传给谁。

**修复方案**：占位符替换。

1. dd/dc 拼 msg 时，`secondPaneId` 填占位符 `'__WORKER_PANE_ID__'`
2. `callWorker` 创建 pane 拿到真实 ID 后，`msg.replace('__WORKER_PANE_ID__', workerPaneId)`
3. 然后写入

`callWorker` 不需要理解协议，只做纯字符串替换。

## 改动清单（含 Bug 2 修复）

### 1. `zellij.ts` — `createFloatingPane` 参数类型

`cmd: string[]` → `cmd: string`

```diff
 export async function createFloatingPane(opts: {
-  cmd: string[];
+  cmd: string;
   geometryKey?: string;
   ...
 }): Promise<string> {
   ...
   const { stdout } = await execAsync(
-    ['zellij', ...args].map(shellQuote).concat(opts.cmd).join(' ')
+    ['zellij', ...args].map(shellQuote).join(' ') + ' ' + opts.cmd
   );
```

### 2. `callWorker.ts` — 新建

从 `sendDelegate` 提取核心逻辑：

```typescript
import { createFloatingPane, wait, writeToPane } from '../lib/zellij';
import { loadConfig } from '../config';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * 创建 worker pane，等待就绪，发送消息
 * @param cmd    在 worker pane 中执行的完整命令字符串
 * @param msg    要发送给 worker 的完整消息字符串
 * @param workerName  用作 pane title 和 geometryKey
 * @returns workerPaneId
 */
export async function callWorker(
  cmd: string,
  msg: string,
  workerName: string,
): Promise<string> {
  const config = loadConfig();

  // 1. 创建 worker pane
  const workerPaneId = await createFloatingPane({
    cmd,
    geometryKey: workerName,
    title: workerName,
    pinned: true,
    defaultWidth: config.workerPane.width,
    defaultHeight: config.workerPane.height,
  });

  // 2. 清理可能残留的旧 ready 文件
  const readinessFile = join(homedir(), '.pi', 'tmp', `pi-in-zellij-ready-${workerPaneId}`);
  try { unlinkSync(readinessFile); } catch (e: any) {
    if (e.code !== 'ENOENT') throw e; // 文件不存在可以忽略，其他错误往上抛
  }

  // 3. 轮询等待 Worker 就绪
  const maxWait = (config.maxWaitSeconds || 5) * 1000;
  const pollInterval = 200;
  let elapsed = 0;
  while (!existsSync(readinessFile) && elapsed < maxWait) {
    await wait(pollInterval);
    elapsed += pollInterval;
  }

  // 4. 就绪后删除文件（防止残留）
  try { unlinkSync(readinessFile); } catch (e: any) {
    if (e.code !== 'ENOENT') throw e;
  }

  // 5. 占位符替换：填入真实的 workerPaneId
  const finalMsg = msg.replace('__WORKER_PANE_ID__', workerPaneId);

  // 6. 发送消息
  await writeToPane(workerPaneId, finalMsg);

  return workerPaneId;
}
```

### 3. `dd.ts` — 改写

自己拼 cmd 和 msg，调用 callWorker：

```diff
 import { isInZellij } from '../lib/zellij';
-import { delegateMsgMaker, sendDelegate } from './delegates';
+import { delegateMsgMaker } from './delegates';
+import { callWorker } from './callWorker';
+import { buildMessage } from './msg-protocol';
+import { generateCommId } from './msg-protocol';
+import { loadConfig } from '../config';
+import { getMyPaneId } from '../lib/zellij';
 import { agentList } from '../lib/agents';

 handler: async (args, ctx) => {
   ...
   const msg = delegateMsgMaker(userInput);
   msg.markdown = msg.task;

-  await sendDelegate(ctx, msg);
+  // 拼 cmd
+  const config = loadConfig();
+  let cmd = 'pi';
+  if (config.models && config.models !== 'auto') cmd += ` --model ${config.models}`;
+  if (config.mode && config.mode !== 'plan') cmd += ` --agentMode ${config.mode}`;
+
+  // 拼 msg（secondPaneId 用占位符，callWorker 会替换为真实 ID）
+  const message = buildMessage(
+    msg.firstPaneId, '__WORKER_PANE_ID__', msg.firstName, msg.secondName,
+    msg.needReply, msg.commId, msg.commType,
+    msg.markdown, msg.agent, msg.firstPid
+  );
+
+  const workerPaneId = await callWorker(cmd, message, config.names.worker);
+  ctx.ui.notify(`✓ Worker 已创建并发送: pane ${workerPaneId}`, 'info');
 }
```

### 4. `dc.ts` — 改写

同 dd.ts，cmd 多加 `--fork`：

```diff
-  await sendDelegate(ctx, msg, sessionFile);
+  let cmd = 'pi';
+  cmd += ` --fork ${sessionFile}`;
+  if (config.models && config.models !== 'auto') cmd += ` --model ${config.models}`;
+  if (config.mode && config.mode !== 'plan') cmd += ` --agentMode ${config.mode}`;
+
+  const message = buildMessage(
+    msg.firstPaneId, '__WORKER_PANE_ID__', msg.firstName, msg.secondName,
+    msg.needReply, msg.commId, msg.commType,
+    msg.markdown, msg.agent, msg.firstPid
+  );
+
+  const workerPaneId = await callWorker(cmd, message, config.names.worker);
+  ctx.ui.notify(`✓ Worker 已创建并发送: pane ${workerPaneId}`, 'info');
```

### 5. `delegates.ts` — 精简

- 保留 `delegateMsgMaker()`（dd/dc 还在用）
- 保留 `CompleteDelegateMsg` 类型
- 删除 `sendDelegate()`（已被 callWorker 替代）

## 执行顺序

1. `zellij.ts` — `cmd: string[]` → `cmd: string`，改 execAsync 拼接方式
2. `callWorker.ts` — 新建
3. `dd.ts` — 改写 handler
4. `dc.ts` — 改写 handler
5. `delegates.ts` — 删除 `sendDelegate()`
6. 验证 — 手动测试 `/dd` 和 `/dc` 命令
