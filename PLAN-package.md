# 打包计划：pi-in-zellij → npm package

## 目标

将 `pi-in-zellij` 打成一个标准的 pi package，用户可通过 `pi install npm:pi-in-zellij` 安装使用。

---

## 设计原则

- **零构建** — pi 用 jiti 直接加载 `.ts`，不需要编译到 `dist/`
- **不改变源码目录结构** — 所有路径在原位置就是正确的
- **配置可覆盖** — 包内提供默认值，用户可在项目级覆盖

---

## 1. 项目结构（不变）

```
pi-in-zellij/
├── package.json        ← 新建
├── index.ts            ← 入口
├── config.json         ← 包内默认配置
├── config.ts
├── editor/
│   ├── editor.ts
│   └── ... (路径引用 lib/save-geo.sh，原地正确)
├── pane-comm/...
├── lib/
│   ├── zellij.ts
│   ├── agents.ts
│   └── save-geo.sh
```

---

## 2. package.json

```json
{
  "name": "pi-in-zellij",
  "version": "0.1.0",
  "description": "Pi extension for zellij — multi-pane communication, delegate, editor",
  "keywords": ["pi-package", "pi-extension", "zellij"],
  "type": "module",
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*"
  },
  "files": [
    "index.ts",
    "config.ts",
    "config.json",
    "editor/",
    "pane-comm/",
    "lib/"
  ],
  "pi": {
    "extensions": ["./index.ts"]
  }
}
```

要点：
- `peerDependencies` — pi 核心包不捆绑，用户已有
- `files` — 显式声明所有要发布的文件（.ts, .json, .sh）
- `pi.extensions` — 直接指向 `./index.ts`，jiti 负责加载
- 不需要 `build`、`main`、`exports`

---

## 3. 配置覆盖机制

### 3.1 现状

`config.ts` 从包内 `config.json` 读取。用户无法自定义 model、mode、pane 尺寸等。

### 3.2 覆盖规则

```
优先级（高 → 低）：
  1. 项目级  .pi/pi-in-zellij/config.json
  2. 包内默认 config.json
```

合并方式：**顶层键级合并**（不是深层 merge），用户配置的键覆盖默认的同名键。

### 3.3 示例

项目 `.pi/pi-in-zellij/config.json`：
```json
{
  "models": "anthropic/claude-sonnet-4",
  "mode": "work"
}
```

未覆盖的字段（`names`、`workerPane`、`editorPane` 等）使用 `config.json` 默认值。

---

## 4. 需要改动的代码

### 4.1 config.ts — 增加用户级覆盖

**改动内容：**
- 将 `config.json` 路径改为通过 `new URL` 定位（更规范的 ESM 做法）
- 加载包内默认 config.json
- 检查是否存在 `.pi/pi-in-zellij/config.json`（相对 `process.cwd()`）
- 如果存在，顶层键合并后返回
- 不需要 deep merge，用户写的键覆盖默认的同名键即可

**修改前：**

```ts
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ... types ...

let cached: PaneCommConfig | null = null;

export function loadConfig(): PaneCommConfig {
  if (cached) return cached;
  const dir = dirname(fileURLToPath(import.meta.url));
  cached = JSON.parse(readFileSync(resolve(dir, 'config.json'), 'utf-8'));
  return cached;
}
```

**修改后：**

```ts
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ... types 保持不变 ...

let cached: PaneCommConfig | null = null;

/** 包内默认 config.json 的路径（相对于本文件在包中的位置） */
const defaultConfigPath = new URL('./config.json', import.meta.url).pathname;

/** 用户项目级覆盖配置路径 */
const projectConfigPath = join(process.cwd(), '.pi', 'pi-in-zellij', 'config.json');

export function loadConfig(): PaneCommConfig {
  if (cached) return cached;

  // 1. 读取包内默认
  const defaults = JSON.parse(readFileSync(defaultConfigPath, 'utf-8'));

  // 2. 如果存在项目级覆盖，顶层键合并
  if (existsSync(projectConfigPath)) {
    const overrides = JSON.parse(readFileSync(projectConfigPath, 'utf-8'));
    cached = { ...defaults, ...overrides };
  } else {
    cached = defaults;
  }

  return cached;
}
```

**用户配置路径：**

```
项目/.pi/pi-in-zellij/config.json
```

放在包名命名的目录下，好处：
- 与其他 pi 包的配置隔离，不冲突
- 为未来扩展预留空间（如缓存、日志等）
- 用户一眼能看出是哪个包的配置

**代码中对应的常量：**

```ts
const projectConfigPath = join(process.cwd(), '.pi', 'pi-in-zellij', 'config.json');
```

**说明：** `new URL('./config.json', import.meta.url)` 不需要关心文件最终在磁盘上的绝对路径，ESM 的 `import.meta.url` + 相对路径能正确解析到包内的 `config.json`。

### 4.2 其他文件 — 不需要改

| 文件 | 理由 |
|------|------|
| `lib/zellij.ts` | geometry 存 `~/.pi/tmp/`，不依赖包路径 |
| `lib/agents.ts` | 从 `process.cwd()` 搜索，运行时行为 |
| `lib/save-geo.sh` | 通过 `$HOME/.pi/tmp/` 存取 geometry，不依赖包路径 |
| `editor/editor.ts` | `import.meta.url` 在当前文件位置时路径是正确的 |
| `pane-comm/*.ts` | 纯逻辑或通过 config.ts 读取配置，无文件路径依赖 |

---

## 5. 验证方法

```bash
# 本地加载测试
pi -e ./index.ts

# 模拟安装
pi install ./path/to/pi-in-zellij

# 检查包内容
npm pack --dry-run           # 查看发布时会包含哪些文件
```

---

## 6. 执行步骤

| 步骤 | 改动文件 | 内容 |
|------|----------|------|
| 1 | `package.json` | 新建，含 peerDeps、files、pi 字段 |
| 2 | `config.ts` | 改为 `new URL` 定位 + 支持 `.pi/pi-in-zellij/config.json` 覆盖 |
| 3 | 验证 | `npm pack --dry-run` + `pi -e ./index.ts` |

## 7. 发布前检查清单（你手动完成，不在计划执行范围内）

以下步骤在执行完 Step 1-3 后，**由你决定是否进行**，不在本计划的自动执行范围内：

- [ ] 确认 README.md 是否需要更新（安装方式、配置说明等）
- [ ] 确认 AGENTS.md 是否需要调整
- [ ] 检查 `npm pack --dry-run` 的输出是否包含了所有必需文件
- [ ] `npm login`（如果还没登录）
- [ ] `npm publish`（你手动操作）
- [ ] 发布后用 `pi install npm:pi-in-zellij` 安装测试
