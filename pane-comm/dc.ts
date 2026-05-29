/**
 * /dc 命令 — 直接发送任务给 worker，继承当前对话上下文
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { AutocompleteItem } from '@earendil-works/pi-tui';
import { isInZellij } from '../lib/zellij';
import { delegateMsgMaker } from './delegates';
import { callWorker } from './callWorker';
import { buildMessage } from './msg-protocol';
import { loadConfig } from '../config';
import { agentList } from '../lib/agents';

export function registerDcCommand(pi: ExtensionAPI) {
  const agentNames = [...agentList.keys()];

  pi.registerCommand('dc', {
    description: '发送任务给 worker（继承当前对话上下文）',
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const items = agentNames.map((name) => ({ value: name, label: name }));
      const filtered = items.filter((i) => i.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const userInput = args.trim();
      if (!userInput) {
        ctx.ui.notify('用法: /dc [agentName] <任务描述>', 'warning');
        if (agentNames.length > 0) {
          ctx.ui.notify(`可用的 agents: ${agentNames.join(', ')}`, 'info');
        }
        return;
      }

      if (!isInZellij()) {
        ctx.ui.notify('⚠️ 当前不在 zellij 中运行，无法使用 /dc', 'warning');
        return;
      }

      const sessionFile = ctx.sessionManager.getSessionFile();
      if (!sessionFile) {
        ctx.ui.notify(
          '⚠️ 当前是 ephemeral session，无法 fork 上下文。请使用 /dd 代替。',
          'warning'
        );
        return;
      }

      const config = loadConfig();
      const msg = delegateMsgMaker(userInput);
      msg.markdown = msg.task;

      // 拼 cmd（带 --fork 继承上下文）
      let cmd = `pi --fork ${sessionFile}`;
      if (config.models && config.models !== 'auto') cmd += ` --model ${config.models}`;
      if (config.mode && config.mode !== 'plan') cmd += ` --agentMode ${config.mode}`;

      // 拼 msg（secondPaneId 用占位符，callWorker 会替换为真实 ID）
      const message = buildMessage(
        msg.firstPaneId,
        '__WORKER_PANE_ID__',
        msg.firstName,
        msg.secondName,
        msg.needReply,
        msg.commId,
        msg.commType,
        msg.markdown,
        msg.agent,
        msg.firstPid,
      );

      const workerPaneId = await callWorker(cmd, message, config.names.worker);
      ctx.ui.notify(`✓ Worker 已创建并发送: pane ${workerPaneId}`, 'info');
    },
  });
}