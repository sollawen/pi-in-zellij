# session_start 自动启动 summon-setup 可行性分析

## 背景

当前流程：用户首次使用时，`session_start` 发现 `config.assistants` 为空，显示警告：

> ⚠️ 尚未配置助手，请运行 /summon-setup 配置。

用户需要手动输入 `/summon-setup`，完成向导后再 `/reload` 才能生效。

**期望**：检测到 assistants 为空时，直接启动 summon-setup 向导，省去手动操作。

## 结论：方案可行

## 实验过程与发现

### 实验对比

| 场景 | `ctx.ui.notify()` | `pi.sendMessage()` |
|------|-------------------|--------------------|
| 命令行启动 `pi` | ✅ 弹出 | ✅ 弹出 |
| `/reload` | ❌ 被冲掉 | ✅ 弹出 |

**问题不在 zellij，不在 `ctx.ui` 本身，而在 `/reload`。**

### reload 时 notify 消失的根因（pi 源码分析）

pi 源码 `interactive-mode.js` 中，reload 流程：

```javascript
await this.session.reload();          // session_start 在此期间触发
this.rebuildChatFromMessages();       // ← 关键
```

`rebuildChatFromMessages()` 内部：

```javascript
rebuildChatFromMessages() {
    this.chatContainer.clear();                           // ← 清空整个聊天区域
    const context = this.sessionManager.buildSessionContext();
    this.renderSessionContext(context);                   // ← 从消息历史重新渲染
}
```

- `ctx.ui.notify()` 只是往 `chatContainer` 临时加了一个 `Text` 组件，**不在会话消息历史中**，被 `clear()` 清掉
- `pi.sendMessage({ display: true })` 写入了会话消息历史，重建后还在
- 首次启动时没有 `rebuildChatFromMessages()` 这一步，notify 留在屏幕上

### 完整验证结果

用 `pi -e ~/pi-dev/ctx-test/testN-xxx.ts` 首次启动测试：

| 测试 | 验证内容 | 结果 |
|------|---------|------|
| test1 | `ctx.ui.notify()` | ✅ 通过 |
| test2 | `ctx.ui.input()` | ✅ 通过 |
| test3 | `ctx.ui.custom()` (SelectList) | ✅ 通过 |
| test4 | 完整向导流程（SelectList + input 循环） | ✅ 通过 |

**首次启动时，`session_start` 中所有 `ctx.ui` 方法均可用。**

## 实现方案

### 设计

1. 先清理无效助理（检查 model 是否在 `modelRegistry.getAvailable()` 中），无效的从列表中删除并 `saveConfig`
2. 根据清理后的名单 + `event.reason` 决定下一步

| 条件 | startup | reload 等其他 |
|------|---------|-------------|
| 无助理（空或全失效） | 提示 + **弹向导** → 完成后注册 summon | 提示 + 不注册 summon |
| 部分失效 | 提示失效名单 + **弹向导** → 完成后注册 summon | 提示失效名单 + 注册剩余正常的 summon |
| 一切正常 | 注册 summon，结束 | 注册 summon，结束 |

### 提示文案

- 无助理："请给你最喜欢的模型起个名字，以后它就会陪在你身边"
- 有失效："你的助理 name1, name2 已失效了，..."
- reload + 无助理追加："需要使用 /summon-setup 来设置你的助理"
- reload + 有失效追加："需要使用 /summon-setup 来配置"

### 改动范围

| 文件 | 改动 |
|------|------|
| `pane-comm/summon-setup.ts` | 提取 `runSummonSetup(ctx)` 函数，命令 handler 调用它 |
| `index.ts` | 重写 `session_start` handler，按上述逻辑分支 |

### `index.ts` session_start 伪代码

```typescript
pi.on('session_start', async (event, ctx) => {
  if (process.env.PI_FLOATING_WORKER) return;

  const config = loadConfig();
  const assistantList = [...(config.assistants ?? [])];
  const available = ctx.modelRegistry.getAvailable();
  const validModelIds = new Set(available.map(m => `${m.provider}/${m.id}`));

  // 清理无效助理
  const deleted: AssistantConfig[] = [];
  const valid: AssistantConfig[] = [];
  for (const a of assistantList) {
    if (validModelIds.has(a.model)) {
      valid.push(a);
    } else {
      deleted.push(a);
    }
  }

  if (deleted.length > 0) {
    saveConfig({ assistants: valid });
  }

  const isStartup = event.reason === 'startup';

  if (valid.length === 0) {
    // 无助理
    pi.sendMessage({
      customType: 'summon-setup',
      content: '请给你最喜欢的模型起个名字，以后它就会陪在你身边',
      display: true,
    });

    if (isStartup) {
      // 弹向导
      const assistants = await runSummonSetup(ctx);
      if (assistants && assistants.length > 0) {
        registerSummonTool(pi, assistants);
      }
    } else {
      pi.sendMessage({
        customType: 'summon-setup',
        content: '需要使用 /summon-setup 来设置你的助理',
        display: true,
      });
    }
    return;
  }

  if (deleted.length > 0) {
    // 部分失效
    const deletedNames = deleted.map(a => a.alias).join(', ');
    const prompt = `你的助理 ${deletedNames} 已失效了`;

    if (isStartup) {
      pi.sendMessage({
        customType: 'summon-setup',
        content: `${prompt}，请重新配置`,
        display: true,
      });
      // 弹向导，完成后用新名单注册
      const assistants = await runSummonSetup(ctx);
      if (assistants && assistants.length > 0) {
        registerSummonTool(pi, assistants);
      } else {
        // 用户跳过向导，注册剩余有效的
        registerSummonTool(pi, valid);
      }
    } else {
      pi.sendMessage({
        customType: 'summon-setup',
        content: `${prompt}，需要使用 /summon-setup 来配置`,
        display: true,
      });
      registerSummonTool(pi, valid);
    }
    return;
  }

  // 一切正常
  registerSummonTool(pi, valid);
});
```

### 实现注意事项

`runSummonSetup()` 内部不调用 `saveConfig`，只返回结果。由调用方决定是否保存：
- 命令 handler：调用后 `saveConfig`
- `session_start`：不重复保存（无效助理已在前面清理时保存过，向导中的修改由向导自己处理）

## 状态

- [x] 可行性分析完成
- [x] ctx.ui 可用性验证（test1-4 全部通过）
- [x] reload 时 notify 消失根因定位（源码分析）
- [x] 评估通过
- [x] 实现
