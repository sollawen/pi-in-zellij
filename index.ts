/**
 * pi-in-zellij — Pi 在 zellij 环境下的统一扩展包
 * 支持多 pane 通信（/delegate, /dd）和外部编辑器（alt+e）
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerEditorShortcut } from './editor/editor';
import { registerDelegateCommand } from './pane-comm/delegates';
import { registerDdCommand } from './pane-comm/dd';
import { registerInterceptor } from './pane-comm/interceptor';

export default function (pi: ExtensionAPI) {
  // 不在 zellij 中时，跳过所有 zellij 相关功能
  if (!process.env.ZELLIJ) return;

  registerEditorShortcut(pi);
  registerDelegateCommand(pi);
  registerDdCommand(pi);
  registerInterceptor(pi);
}