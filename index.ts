/**
 * pi-in-zellij — Pi 在 zellij 环境下的统一扩展包
 * 支持多 pane 通信（/dc, /dd）和外部编辑器（alt+e）
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerEditorShortcut } from './editor/editor';
import { registerDcCommand } from './pane-comm/dc';
import { registerDdCommand } from './pane-comm/dd';
import { registerInterceptor } from './pane-comm/interceptor';
import { registerSummonTool } from './pane-comm/summon';
import { registerSummonSetupCommand } from './pane-comm/summon-setup';
import { loadConfig, saveConfig } from './config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getMyPaneId } from './lib/zellij';

export default function (pi: ExtensionAPI) {
  // 不在 zellij 中时，跳过所有 zellij 相关功能
  if (!process.env.ZELLIJ) return;

  // ---- session_start：worker pane 就绪后写入 readiness file ----
  pi.on('session_start', () => {
    if (!process.env.PI_FLOATING_WORKER) return; // 只有 worker 才写
    try {
      const piTmpDir = join(homedir(), '.pi', 'tmp');
      mkdirSync(piTmpDir, { recursive: true });
      const readinessFile = join(piTmpDir, `pi-in-zellij-ready-${getMyPaneId()}`);
      writeFileSync(readinessFile, 'ready', 'utf8');
    } catch (err) {
      console.error('[pi-in-zellij] failed to write readiness file:', err);
    }
  });

  // ---- session_start：Phase A 模型校验 + summon tool 注册 ----
  pi.on('session_start', async (_event, ctx) => {
    if (process.env.PI_FLOATING_WORKER) return;  // 只在 main pane 执行

    const config = loadConfig();
    const assistantList = [...(config.assistants ?? [])];
    let assReady = true;

    if (assistantList.length === 0) {
      assReady = false;
    } else {
      const available = ctx.modelRegistry.getAvailable();
      const validModelIds = new Set(available.map(m => `${m.provider}/${m.id}`));

      const toDelete: typeof assistantList = [];
      for (let i = assistantList.length - 1; i >= 0; i--) {
        if (!validModelIds.has(assistantList[i].model)) {
          toDelete.push(assistantList[i]);
          assistantList.splice(i, 1);
        }
      }

      if (toDelete.length > 0) {
        saveConfig({ assistants: assistantList });
        pi.sendMessage({
          customType: 'summon-setup',
          content: `⚠️ 已移除无效助手: ${toDelete.map(a => `${a.alias}(${a.model})`).join(', ')}。请运行 /summon-setup 重新配置。`,
          display: true,
        });
      }

      if (assistantList.length === 0) {
        assReady = false;
      }
    }

    if (!assReady) {
      pi.sendMessage({
        customType: 'summon-setup',
        content: '⚠️ 尚未配置助手，请运行 /summon-setup 配置。',
        display: true,
      });
      return;
    }

    registerSummonTool(pi, assistantList);
  });

  registerEditorShortcut(pi);
  registerDcCommand(pi);
  registerDdCommand(pi);
  registerInterceptor(pi);
  registerSummonSetupCommand(pi);
}