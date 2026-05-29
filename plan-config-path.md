# Plan: config.json 用户级配置路径

## 现状

`config.ts` 目前支持两级：

```
项目级 .pi/pi-in-zellij/config.json  >  包内默认 config.json
```

**问题**：
1. 没有用户级全局配置，用户只能改包内文件（npm 更新会覆盖）或每个项目建一份
2. 包内默认值里的模型是作者的，不是通用的
3. `.pi/pi-in-zellij/config.json` 不符合 pi 的项目级目录惯例

## 目标

用户级配置文件：`~/.pi/agent/pi-in-zellij.json`

逻辑：
- **有** → 直接读取，这是唯一的配置来源
- **没有** → 把包内默认 `config.json` 复制过去，再读取

```
~/.pi/agent/pi-in-zellij.json（唯一配置来源）
  ↑ 首次使用时从包内 config.json 复制生成
```

好处：
- `loadConfig()` 只读一个文件，没有合并逻辑
- 用户打开文件就能看到所有可配置项
- npm 更新不会覆盖用户配置

## 改动范围

只改 `config.ts` 一个文件。

---

## 具体改动

### 1. 用 `getAgentDir()` 定义路径

```typescript
import { getAgentDir } from '@earendil-works/pi-coding-agent';

const defaultConfigPath = new URL('./config.json', import.meta.url).pathname;
const userConfigFile = join(getAgentDir(), 'pi-in-zellij.json');
```

### 2. `loadConfig()` 简化

```typescript
export function loadConfig(): PaneCommConfig {
  if (cached) return cached;

  // 首次使用：把包内默认复制到用户级
  if (!existsSync(userConfigFile)) {
    copyFileSync(defaultConfigPath, userConfigFile);
  }

  cached = JSON.parse(readFileSync(userConfigFile, 'utf-8'));
  return cached;
}
```

### 3. 导出路径常量、缓存清除、保存函数

```typescript
/** 用户级配置文件路径 */
export { userConfigFile };

/** 清除缓存，下次 loadConfig() 重新读取磁盘 */
export function invalidateConfigCache(): void {
  cached = null;
}

/** 将配置保存到用户级配置文件（顶层键合并，保留已有字段） */
export function saveConfig(partial: Partial<PaneCommConfig>): void {
  let existing: Record<string, any> = {};
  if (existsSync(userConfigFile)) {
    existing = JSON.parse(readFileSync(userConfigFile, 'utf-8'));
  }

  const merged = { ...existing, ...partial };
  writeFileSync(userConfigFile, JSON.stringify(merged, null, 2) + '\n', 'utf-8');

  invalidateConfigCache();
}
```

### 4. 删除项目级配置

移除 `projectConfigPath` 及其相关逻辑。

---

## 不改的东西

- `PaneCommConfig` 接口 — 不变
- `loadConfig()` 返回类型 — 不变
- 所有调用 `loadConfig()` 的地方 — 不需要改动（summon.ts, dd.ts, dc.ts, callWorker.ts, editor.ts）
- `index.ts` — 不需要改动
- 包内 `config.json` — 保留作为初始模板（后续 summon-setup 计划中再去调整 assistants 的默认值）

## 关于错误处理

Lisa (review) 建议对 `copyFileSync` 加 try/catch 失败时回退读包内默认。我们决定**不加**，理由：

- 回退到包内默认意味着用户拿到了作者的模型配置，模型大概率不存在，pane 闪退，体验更差
- `~/.pi/agent/` 是 pi 运行的前提目录，一定存在且可写，copy 失败是极端异常
- 极端异常就应该暴露出来，不要静默回退到一个坏的状态

## 验证方式

1. 删除 `~/.pi/agent/pi-in-zellij.json` → loadConfig() 自动从包内复制一份过去，返回默认值
2. 手动修改用户级文件 → loadConfig() 返回修改后的值
3. 调用 `saveConfig({ assistants: [...] })` → 文件被更新，缓存被清除，下次 loadConfig() 返回新值
4. npm 更新包 → 用户级文件不受影响
