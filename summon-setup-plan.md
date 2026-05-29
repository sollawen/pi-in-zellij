# Summon 助手配置方案

## 问题

1. 新用户不知道需要在 `config.json` 里手写模型名
2. 写错了模型名（或模型后来不可用了），pane 闪退，没有任何错误提示
3. 配置文件只有项目级路径，没有用户级全局配置

## 方案概览

三件事：

| # | 内容 | 效果 |
|---|------|------|
| A | 初始化时校验 assistants 模型有效性 | 无效模型不再静默失败 |
| B | `/summon-setup` 向导命令 | 用户不需要知道模型字符串格式 |
| C | 增加用户级全局配置路径 | 一次配置，所有项目通用 |

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

config.json 里的 model 字段格式是 `provider/modelId`（如 `minimax-cn/MiniMax-M2.7:medium`）。

`ctx.modelRegistry.getAvailable()` 返回 `Model[]`，每个 Model 有：
- `model.provider`: `"anthropic"`, `"openai"`, `"minimax-cn"` 等
- `model.id`: `"claude-sonnet-4-5"`, `"MiniMax-M2.7:medium"` 等

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

### 交互流程

```
用户输入: /summon-setup

Step 1: 检查现有配置
  → 如果已有 assistants 配置，显示当前配置并问是否修改

Step 2: 添加助手
  → "输入助手名字（如 Lisa）:"   [input]
  → 显示可用模型列表:            [select]
     1. anthropic/claude-sonnet-4-5 — Claude Sonnet 4.5
     2. openai/gpt-4.1 — GPT-4.1
     3. minimax-cn/MiniMax-M2.7:medium — MiniMax M2.7 Medium
     ...
  → 用户选择一个模型

Step 3: 是否继续添加？
  → [confirm] "是否继续添加助手?"
  → 是 → 回到 Step 2
  → 否 → 保存并退出

Step 4: 保存
  → 写入 config.json（用户级或项目级）
  → notify "✓ 配置已保存。请运行 /reload 生效。"
```

### 实现要点

```typescript
pi.registerCommand("summon-setup", {
  description: "配置 summon 助手的模型",
  handler: async (_args, ctx) => {
    const config = loadConfig();
    const available = ctx.modelRegistry.getAvailable();

    if (available.length === 0) {
      ctx.ui.notify("没有可用的模型。请先配置 API Key（运行 /login）。", "error");
      return;
    }

    // 显示当前配置（如有）
    if (config.assistants?.length) {
      ctx.ui.notify(`当前助手: ${config.assistants.map(a => `${a.alias} → ${a.model}`).join(', ')}`, "info");
    }

    const assistants: AssistantConfig[] = [];
    let addMore = true;

    while (addMore) {
      // 输入名字
      const alias = await ctx.ui.input("助手名字:", assistants.length === 0 ? "Lisa" : undefined);
      if (!alias) break;

      // 选择模型
      const modelOptions = available.map(m => ({
        value: `${m.provider}/${m.id}`,
        label: `${m.provider}/${m.id} — ${m.name}`,
      }));
      const selectedModel = await ctx.ui.select("选择模型:", modelOptions);
      if (!selectedModel) break;

      assistants.push({ alias, model: selectedModel });

      // 是否继续
      addMore = await ctx.ui.confirm("继续添加助手?", "") ?? false;
    }

    if (assistants.length === 0) {
      ctx.ui.notify("未做任何更改。", "info");
      return;
    }

    // 保存配置
    saveAssistantConfig(assistants);
    ctx.ui.notify(`✓ 已配置 ${assistants.length} 个助手。请运行 /reload 生效。`, "info");
  },
});
```

### 保存位置选择

`/summon-setup` 默认保存到 **用户级配置**（`~/.pi/pi-in-zellij/config.json`）。

如果用户在某个项目下想用不同的模型，可以：
- 手动创建 `.pi/pi-in-zellij/config.json` 覆盖
- 或后续增加 `--project` 参数让向导保存到项目级

---

## C. 增加用户级全局配置路径

### 当前配置加载优先级

```
项目级 .pi/pi-in-zellij/config.json  >  包内默认 config.json
```

### 改为三级

```
项目级 .pi/pi-in-zellij/config.json  >  用户级 ~/.pi/pi-in-zellij/config.json  >  包内默认 config.json
```

### config.ts 改动

```typescript
const defaultConfigPath = new URL('./config.json', import.meta.url).pathname;
const userConfigPath = join(homedir(), '.pi', 'pi-in-zellij', 'config.json');
const projectConfigPath = join(process.cwd(), '.pi', 'pi-in-zellij', 'config.json');

export function loadConfig(): PaneCommConfig {
  if (cached) return cached;

  // 1. 包内默认
  const defaults = JSON.parse(readFileSync(defaultConfigPath, 'utf-8'));

  // 2. 用户级覆盖
  let merged = { ...defaults };
  if (existsSync(userConfigPath)) {
    const userOverrides = JSON.parse(readFileSync(userConfigPath, 'utf-8'));
    merged = { ...merged, ...userOverrides };
  }

  // 3. 项目级覆盖
  if (existsSync(projectConfigPath)) {
    const projectOverrides = JSON.parse(readFileSync(projectConfigPath, 'utf-8'));
    merged = { ...merged, ...projectOverrides };
  }

  cached = merged;
  return cached;
}
```

### saveAssistantConfig 实现

```typescript
import { homedir } from 'node:os';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

function saveAssistantConfig(assistants: AssistantConfig[]) {
  const dir = join(homedir(), '.pi', 'pi-in-zellij');
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, 'config.json');

  // 读取已有配置（如果有），只覆盖 assistants 字段
  let existing: Record<string, any> = {};
  if (existsSync(filePath)) {
    existing = JSON.parse(readFileSync(filePath, 'utf-8'));
  }
  existing.assistants = assistants;

  writeFileSync(filePath, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
  invalidateConfigCache();  // 清除 loadConfig 的缓存
}
```

---

## 默认 config.json 改动

包内的默认 `config.json` 应该 **去掉 assistants 配置**（或留空数组）：

```json
{
  "names": {
    "main": "Main",
    "worker": "Mike"
  },
  "assistants": [],
  "workerPane": { ... },
  "editorPane": { ... },
  "maxWaitSeconds": 5,
  "models": "minimax-cn/MiniMax-M2.7",
  "mode": "work"
}
```

理由：
- 默认不启用 summon，避免新用户撞上"模型不存在"的问题
- 用户运行 `/summon-setup` 后自动启用

---

## 实现顺序

| 阶段 | 内容 | 风险 |
|------|------|------|
| 1 | C — 三级配置路径 | 低，纯配置读取改动 |
| 2 | A — 初始化校验 + summon tool 过滤 | 低，只加校验逻辑 |
| 3 | B — `/summon-setup` 向导 | 中，涉及用户交互 |

## 文件改动清单

| 文件 | 改动 |
|------|------|
| `config.ts` | 三级配置加载 + `saveAssistantConfig` + 缓存清除 |
| `config.json` | assistants 改为空数组 |
| `index.ts` | `session_start` 中增加模型校验 + 注册 `/summon-setup` 命令 |
| `pane-comm/summon.ts` | 注册时过滤无效助手 |
| 新文件 `pane-comm/summon-setup.ts` | `/summon-setup` 命令实现 |
