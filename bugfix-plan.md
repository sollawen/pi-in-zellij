# Bugfix 计划

## Bug 1：Summon 的 work pi 关闭时未保存 pane 位置

### 根因

创建和关闭时使用的 geometryKey 不一致：

- **创建时**（`callWorker.ts`）：`geometryKey` 使用助手别名，如 `"Lisa"`
- **关闭时**（`interceptor.ts`）：`closeFloatingPane` 硬编码为 `'worker'`

导致 `[Lisa]` / `[Jackey]` 的位置记录从未被写入 `zellij-geometry` 文件，而 `[worker]` 被错误覆盖。

### 修复方案：统一使用 `secondName` 作为 geometryKey

不管 dd/dc 还是 summon，消息里都有 `secondName` 字段，用它做 geometryKey：

| 场景 | secondName | geometry key |
|------|-----------|-------------|
| dd/dc | `"Mike"`（config.names.worker） | `[Mike]` |
| Summon Lisa | `"Lisa"`（found.alias） | `[Lisa]` |
| Summon Jackey | `"Jackey"`（found.alias） | `[Jackey]` |

config.json 已将 `names.worker` 改为 `"Mike"`，与助手别名不冲突。

### 改动

**文件：`pane-comm/dd.ts` / `pane-comm/dc.ts`**

`callWorker(cmd, message, 'worker')` → `callWorker(cmd, message, config.names.worker)`：

```typescript
// 修改前
const workerPaneId = await callWorker(cmd, message, 'worker');

// 修改后
const config = loadConfig();
const workerPaneId = await callWorker(cmd, message, config.names.worker);
```

**文件：`pane-comm/interceptor.ts`**

`agent_end` finally 块中，硬编码 `'worker'` 改为 `task.secondName`：

```typescript
// 修改前
finally {
  await closeFloatingPane(getMyPaneId(), 'worker');
}

// 修改后
finally {
  await closeFloatingPane(getMyPaneId(), task.secondName);
}
```

### 影响范围

- `dd.ts`：1 行改动
- `dc.ts`：1 行改动
- `interceptor.ts`：1 行改动
- `summon.ts`：不需要改（已传 `found.alias`，就是 `secondName`）

---

## Bug 2：`~/.pi/tmp/` 残留 `pi-in-zellij-ready-terminal_*` 临时文件

### 根因

`session_start` hook 对**所有** pi 实例（包括主 pane）都无条件写入 readiness file。但只有 `callWorker` 创建的 worker pane 的文件才会被等待并删除。主 pane 的 readiness file 永远没人清理，成为孤儿文件。

### 修复

**文件：`pane-comm/callWorker.ts`**

在创建 worker pane 时，给 cmd 前面加上环境变量标记：

```typescript
// 修改前
const workerPaneId = await createFloatingPane({ cmd, ... });

// 修改后
const taggedCmd = `PI_FLOATING_WORKER=1 ${cmd}`;
const workerPaneId = await createFloatingPane({ cmd: taggedCmd, ... });
```

**文件：`index.ts`**（扩展入口）

将 `session_start` hook 从 `interceptor.ts` 移到 `index.ts`，并加上 `PI_FLOATING_WORKER` 守卫。

readiness file 的写入是 pi 启动就绪的通知机制，与 interceptor（截获消息）、callWorker（创建 worker）都无关，应作为独立功能在入口注册。

```typescript
// index.ts 新增
import { getMyPaneId } from './lib/zellij';

pi.on('session_start', () => {
  if (!process.env.PI_FLOATING_WORKER) return;  // 只有 worker 才写
  const piTmpDir = join(homedir(), '.pi', 'tmp');
  mkdirSync(piTmpDir, { recursive: true });
  const readinessFile = join(piTmpDir, `pi-in-zellij-ready-${getMyPaneId()}`);
  writeFileSync(readinessFile, 'ready', 'utf8');
});
```

**文件：`pane-comm/interceptor.ts`**

1. 删除 `session_start` hook 的整段代码（已移至 `index.ts`）
2. 清理因删除 `session_start` 而变成死代码的 import：
   - `writeFileSync`, `mkdirSync`（来自 `node:fs`）
   - `join`（来自 `node:path`）
   - `homedir`（来自 `node:os`）

### 影响范围

- `callWorker.ts`：1 行改动
- `index.ts`：新增 `session_start` hook 注册
- `interceptor.ts`：删除 `session_start` 块，相关 import 不再需要的也一并清理
- 主 pane 不再写 readiness file（无副作用）
- worker pane 行为不变（环境变量被 shell 继承）

---

## 改动汇总

| 文件 | 改动点 |
|------|--------|
| `pane-comm/dd.ts` | `callWorker` 第三参 `'worker'` → `config.names.worker` |
| `pane-comm/dc.ts` | `callWorker` 第三参 `'worker'` → `config.names.worker` |
| `pane-comm/interceptor.ts` | 删除 `session_start` 块；`agent_end` finally 用 `task.secondName` |
| `pane-comm/callWorker.ts` | cmd 前加 `PI_FLOATING_WORKER=1` 环境变量 |
| `index.ts` | 新增 `session_start` hook（从 interceptor 移入，加 `PI_FLOATING_WORKER` 守卫） |

共 5 个文件，5 处改动。
