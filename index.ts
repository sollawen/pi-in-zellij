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
import { loadConfig } from './config';
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

  registerEditorShortcut(pi);
  registerDcCommand(pi);
  registerDdCommand(pi);
  registerInterceptor(pi);

  // 有 assistants 配置时才注册 summon tool
  const config = loadConfig();
  if (config.assistants?.length) {
    registerSummonTool(pi);
  }
}