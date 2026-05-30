import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { DynamicBorder } from '@earendil-works/pi-coding-agent';
import { Container, SelectList, Text, type SelectItem } from '@earendil-works/pi-tui';
import { loadConfig, saveConfig } from '../config';
import type { AssistantConfig } from '../config';

/**
 * 运行 summon setup 向导，返回配置好的助手列表
 * 
 * @param ctx - Extension context
 * @returns 助配置列表（用户可能跳过向导，返回 []）
 */
export async function runSummonSetup(ctx: ExtensionContext): Promise<AssistantConfig[]> {
  const available = ctx.modelRegistry.getAvailable();

  if (available.length === 0) {
    ctx.ui.notify("No models available in Pi. Please configure Pi first (run /login).", "error");
    return [];
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
      container.addChild(new Text(theme.fg("accent", theme.bold("Summon Setup — Give Your Favorite Models a Name")), 1, 0));

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

      container.addChild(new Text(theme.fg("dim", "↑↓ Navigate · Enter Select · Esc Save & Exit"), 1, 0));
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
      ? `Name for ${selected} (current: ${currentAlias}):`
      : `Name for ${selected}:`;
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

  return assistants;
}

export function registerSummonSetupCommand(pi: ExtensionAPI) {
  pi.registerCommand("summon-setup", {
    description: "Configure models for summon assistants",
    handler: async (_args, ctx) => {
      const assistants = await runSummonSetup(ctx);

      if (assistants.length > 0) {
        saveConfig({ assistants });
        ctx.ui.notify(
          `✓ Configured ${assistants.length} assistant(s): ${assistants.map(a => a.alias).join(', ')}. Run /reload to apply.`,
          "info",
        );
      } else {
        ctx.ui.notify("No changes made.", "info");
      }
    },
  });
}