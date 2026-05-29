# Plan: `/summon-setup` 向导

## 模型 ID 规则

配置和显示中，模型 ID 只用 `provider/id`（如 `minimax-cn/MiniMax-M2.7`），**不带 thinking level 后缀**（如 `:medium`、`:high`）。

`ctx.modelRegistry.getAvailable()` 返回的 `model.id` 本身不含 thinking level，所以向导选出来的天然就是干净的。包内默认 `config.json` 里的旧格式（如 `MiniMax-M2.7:medium`）在用户运行 `/summon-setup` 后会被覆盖。

thinking level 支持以后再加。

## 交互流程

用 SelectList 多轮选择 + input 起名字，循环直到用户退出：

```
1. 显示 SelectList：所有可用 model，已起名的标 ✓
2. 用户选一个 model → input 弹出让用户输入名字
3. 名字确认后回到 SelectList（该行变成 ✓ Lisa）
4. 重复 2-3，直到用户按 Esc 退出
5. 收集所有有名字的 model → saveConfig({ assistants })
6. notify "✓ 已配置 N 个助手。请运行 /reload 生效。"
```

### 示例

第一轮：
```
  anthropic/claude-sonnet-4-5
▸ anthropic/claude-haiku-3-5       ← 用户选了这个
  minimax-cn/MiniMax-M2.7
  openai/gpt-4.1
```
→ 弹出 input："给 anthropic/claude-haiku-3-5 起个名字:" → 用户输入 "Mini"

第二轮：
```
  anthropic/claude-haiku-3-5   ✓ Mini   ← 已起名
▸ anthropic/claude-sonnet-4-5          ← 用户选了这个
  minimax-cn/MiniMax-M2.7
  openai/gpt-4.1
```
→ 弹出 input："给 anthropic/claude-sonnet-4-5 起个名字:" → 用户输入 "Lisa"

Esc 退出 → 保存 Lisa + Mini

## 改动范围

| 文件 | 改动 |
|------|------|
| 新文件 `pane-comm/summon-setup.ts` | `/summon-setup` 命令实现 |
| `index.ts` | 导入并注册命令（始终注册） |

## 实现

### `pane-comm/summon-setup.ts`

```typescript
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { DynamicBorder } from '@earendil-works/pi-coding-agent';
import { Container, SelectList, Text, type SelectItem } from '@earendil-works/pi-tui';
import { loadConfig, saveConfig } from '../config';
import type { AssistantConfig } from '../config';

export function registerSummonSetupCommand(pi: ExtensionAPI) {
  pi.registerCommand("summon-setup", {
    description: "配置 summon 助手的模型",
    handler: async (_args, ctx) => {
      const available = ctx.modelRegistry.getAvailable();

      if (available.length === 0) {
        ctx.ui.notify("没有可用的模型。请先配置 API Key（运行 /login）。", "error");
        return;
      }

      // 读取当前配置，预填已有名字
      const config = loadConfig();
      const aliasMap = new Map<string, string>();
      for (const a of config.assistants ?? []) {
        aliasMap.set(a.model, a.alias);
      }

      // 循环选择
      let keepGoing = true;
      while (keepGoing) {
        // 构建 SelectItem 列表
        const items: SelectItem[] = available.map(m => {
          const modelId = `${m.provider}/${m.id}`;
          const alias = aliasMap.get(modelId);
          const label = alias
            ? `${modelId}  ✓ ${alias}`
            : modelId;
          const description = m.name;
          return { value: modelId, label, description };
        });

        // 显示 SelectList
        const selected = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
          const container = new Container();

          container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
          container.addChild(new Text(theme.fg("accent", theme.bold("Summon Setup — 选择模型起名字")), 1, 0));
          container.addChild(new Text(theme.fg("muted", "选一个模型起名字，Esc 完成并保存"), 1, 0));
          container.addChild(new Text("", 0, 0)); // spacer

          const selectList = new SelectList(items, Math.min(items.length, 12), {
            selectedPrefix: (t) => theme.fg("accent", t),
            selectedText: (t) => theme.fg("accent", t),
            description: (t) => theme.fg("muted", t),
            scrollInfo: (t) => theme.fg("dim", t),
            noMatch: (t) => theme.fg("warning", t),
          });
          selectList.onSelect = (item) => done(item.value);
          selectList.onCancel = () => done(null);
          container.addChild(selectList);

          container.addChild(new Text(theme.fg("dim", "↑↓ 移动 · 回车选择 · Esc 保存退出"), 1, 0));
          container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

          return {
            render: (w) => container.render(w),
            invalidate: () => container.invalidate(),
            handleInput: (data) => { selectList.handleInput(data); tui.requestRender(); },
          };
        }, { overlay: true });

        // 用户取消（Esc）→ 结束循环
        if (!selected) {
          keepGoing = false;
          break;
        }

        // 弹出 input 让用户起名字（ctx.ui.input 不支持预填，把当前名字显示在标题里）
        const currentAlias = aliasMap.get(selected);
        const title = currentAlias
          ? `给 ${selected} 起个名字（当前: ${currentAlias}）:`
          : `给 ${selected} 起个名字:`;
        const newAlias = await ctx.ui.input(title);

        if (newAlias && newAlias.trim()) {
          aliasMap.set(selected, newAlias.trim());
        } else {
          // 空名字 = 取消起名（如果之前有名字也清掉）
          aliasMap.delete(selected);
        }
      }

      // 收集结果
      const assistants: AssistantConfig[] = [];
      for (const [model, alias] of aliasMap) {
        if (alias) {
          assistants.push({ alias, model });
        }
      }

      if (assistants.length > 0) {
        saveConfig({ assistants });
        ctx.ui.notify(
          `✓ 已配置 ${assistants.length} 个助手: ${assistants.map(a => a.alias).join(', ')}。请运行 /reload 生效。`,
          "info",
        );
      } else {
        ctx.ui.notify("未做任何更改。", "info");
      }
    },
  });
}
```

### `index.ts` 改动

```typescript
import { registerSummonSetupCommand } from './pane-comm/summon-setup';

// 在函数体中添加（始终注册，不受 assistants 是否为空影响）：
registerSummonSetupCommand(pi);
```
