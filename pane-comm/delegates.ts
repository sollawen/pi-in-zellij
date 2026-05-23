/**
 * /delegate 命令 + pendingWorker 状态
 * v3：合并 state.ts，sendDelegate 改用新 API
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { AutocompleteItem } from '@earendil-works/pi-tui';
import { loadConfig } from '../config';
import { isInZellij, getMyPaneId, createFloatingPane, wait, writeToPane } from '../lib/zellij';
import { agentList, parseAgentInput } from '../lib/agents';
import { generateCommId, buildMessage } from './msg-protocol';

// ---- pendingWorker：Main 侧等待 LLM 生成 prompt 的状态 ----

export interface PendingWorkerData {
  firstPaneId: string;
  secondPaneId: string;
  firstName: string;
  secondName: string;
  commId: string;
  agent?: string;
  task: string;
  markdown: string;
}

export const pendingWorker = {
  data: null as PendingWorkerData | null,
  set(data: PendingWorkerData) {
    this.data = data;
  },
  clear() {
    this.data = null;
  },
};

// ---- 公用类型 ----

export interface CompleteDelegateMsg {
  firstPaneId: string;
  secondPaneId: string;
  firstName: string;
  secondName: string;
  needReply: boolean;
  commId: string;
  commType: string;
  markdown: string;
  agent?: string;
  firstPid?: number;
}

export interface DelegateCtx {
  ui: { notify: (msg: string, level: string) => void };
}

// ---- 公用函数 ----

/** 纯数据准备（不碰 zellij，不建 pane） */
export function delegateMsgMaker(userInput: string): CompleteDelegateMsg & { task: string } {
  const { agent, task } = parseAgentInput(userInput, [...agentList.keys()]);
  const config = loadConfig();
  const myPaneId = getMyPaneId();

  return {
    firstPaneId: myPaneId,
    secondPaneId: '',
    firstName: config.names.main,
    secondName: config.names.worker,
    needReply: true,
    commId: generateCommId(),
    commType: 'Delegate',
    markdown: '',
    agent,
    task,
    firstPid: process.pid,
  };
}

/** 创建 pane + 发送（唯一的 pane 创建 + 发送出口） */
export async function sendDelegate(ctx: DelegateCtx, msg: CompleteDelegateMsg): Promise<void> {
  const config = loadConfig();

  // 构建 pi 命令参数
  const cmd = ['pi'];
  if (config.models && config.models !== 'auto') cmd.push('--model', config.models);
  if (config.mode && config.mode !== 'plan') cmd.push('--agentMode', config.mode);

  // 创建 worker pane（zellij.ts 内部自动恢复位置）
  const workerPaneId = await createFloatingPane({
    cmd,
    geometryKey: 'worker',
    title: config.names.worker,
    pinned: true,
    defaultWidth: config.workerPane.width,
    defaultHeight: config.workerPane.height,
  });
  const finalMsg = { ...msg, secondPaneId: workerPaneId };
  ctx.ui.notify(`✓ Worker 已创建: pane ${workerPaneId}`, 'info');

  // 等待 worker 的 pi 启动就绪
  await wait(config.startupWaitSeconds * 1000);

  // 构建协议消息并发送
  const message = buildMessage(
    finalMsg.firstPaneId,
    finalMsg.secondPaneId,
    finalMsg.firstName,
    finalMsg.secondName,
    finalMsg.needReply,
    finalMsg.commId,
    finalMsg.commType,
    finalMsg.markdown,
    finalMsg.agent,
    finalMsg.firstPid
  );

  await writeToPane(workerPaneId, message);
  ctx.ui.notify('✓ 已发送给 Worker', 'info');
}

// ---- 注册 /delegate 命令 ----

export function registerDelegateCommand(pi: ExtensionAPI) {
  const agentNames = [...agentList.keys()];

  pi.registerCommand('delegate', {
    description: '委托任务给自动创建的 worker',
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const items = agentNames.map((name) => ({ value: name, label: name }));
      const filtered = items.filter((i) => i.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const userInput = args.trim();
      if (!userInput) {
        ctx.ui.notify('用法: /delegate [agentName] <任务描述>', 'warning');
        if (agentNames.length > 0) {
          ctx.ui.notify(`可用的 agents: ${agentNames.join(', ')}`, 'info');
        }
        return;
      }

      if (!isInZellij()) {
        ctx.ui.notify('⚠️ 当前不在 zellij 中运行，无法使用 /delegate', 'warning');
        return;
      }

      const msg = delegateMsgMaker(userInput);

      // 设 pendingWorker，供 agent_end 里调用 sendDelegate
      pendingWorker.set({
        firstPaneId: msg.firstPaneId,
        secondPaneId: '',
        firstName: msg.firstName,
        secondName: msg.secondName,
        commId: msg.commId,
        agent: msg.agent,
        markdown: '',
        task: msg.task,
      });

      // 请 LLM 生成 prompt（LLM 完成后触发 agent_end，在那里调用 sendDelegate）
      await pi.sendUserMessage(`请为以下委托任务生成一份完整的、面向 Worker 的 prompt。

用户原始请求：${msg.task}

要求：
1. Worker 没有当前对话的上下文，请补充必要的背景信息
2. 包含相关文件路径、关键讨论细节、注意事项等
3. 直接输出 prompt 内容即可，不需要做其他事情`);
    },
  });
}