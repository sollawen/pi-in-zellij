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
          const aliasPart = alias ? alias.padEnd(10) : '          ';
          const label = `${aliasPart}${modelId}`;
          const description = undefined;
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
        });

        // 用户取消（Esc）→ 结束循环
        if (!selected) {
          keepGoing = false;
          break;
        }

        // 弹出 input 让用户起名字
        const currentAlias = aliasMap.get(selected);
        const title = currentAlias
          ? `给 ${selected} 起个名字（当前: ${currentAlias}):`
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