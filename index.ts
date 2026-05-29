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
import { runSummonSetup, registerSummonSetupCommand } from './pane-comm/summon-setup';
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
    const available = ctx.modelRegistry.getAvailable();
    const validModelIds = new Set(available.map(m => `${m.provider}/${m.id}`));

    // 清理无效助理
    const deleted: typeof assistantList = [];
    const valid: typeof assistantList = [];
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

    const isStartup = _event.reason === 'startup';

    if (valid.length === 0) {
      // 无助理
      if (isStartup) {
        // 首次启动：弹向导
        ctx.ui.notify('请给你最喜欢的模型起个名字，以后它就会陪在你身边', 'info');
        const assistants = await runSummonSetup(ctx);
        if (assistants && assistants.length > 0) {
          saveConfig({ assistants });
          registerSummonTool(pi, assistants);
        }
      } else {
        // reload 等其他情况：不弹向导
        pi.sendMessage({
          customType: 'summon-setup',
          content: '⚠️ 尚未配置助手，需要使用 /summon-setup 来设置你的助理',
          display: true,
        });
      }
      return;
    }

    if (deleted.length > 0) {
      // 部分失效
      const deletedNames = deleted.map(a => a.alias).join(', ');
      if (isStartup) {
        // 首次启动：弹向导
        ctx.ui.notify(`你的助理 ${deletedNames} 已失效了，请重新配置`, 'warning');
        const assistants = await runSummonSetup(ctx);
        if (assistants && assistants.length > 0) {
          saveConfig({ assistants });
          registerSummonTool(pi, assistants);
        } else {
          // 用户跳过向导，注册剩余有效的
          registerSummonTool(pi, valid);
        }
      } else {
        // reload 等其他情况
        pi.sendMessage({
          customType: 'summon-setup',
          content: `⚠️ 你的助理 ${deletedNames} 已失效了，需要使用 /summon-setup 来配置`,
          display: true,
        });
        registerSummonTool(pi, valid);
      }
      return;
    }

    // 一切正常
    registerSummonTool(pi, valid);
  });

  registerEditorShortcut(pi);
  registerDcCommand(pi);
  registerDdCommand(pi);
  registerInterceptor(pi);
  registerSummonSetupCommand(pi);
}