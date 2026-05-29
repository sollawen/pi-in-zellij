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

export default function (pi: ExtensionAPI) {
  // 不在 zellij 中时，跳过所有 zellij 相关功能
  if (!process.env.ZELLIJ) return;

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