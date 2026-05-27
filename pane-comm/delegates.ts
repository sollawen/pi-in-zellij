/**
 * delegate 命令共用逻辑
 * /dd 和 /dc 都用这里导出的 delegateMsgMaker + sendDelegate
 */

import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { loadConfig } from '../config';
import { getMyPaneId, createFloatingPane, wait, writeToPane } from '../lib/zellij';
import { agentList, parseAgentInput } from '../lib/agents';
import { generateCommId, buildMessage } from './msg-protocol';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

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

/** 创建 pane + 发送（唯一的 pane 创建 + 发送出口）
 * @param ctx ExtensionContext
 * @param msg 委托消息
 * @param contextFile 有值时通过 --fork 继承该 session 文件的上下文
 */
export async function sendDelegate(
  ctx: ExtensionContext,
  msg: CompleteDelegateMsg,
  contextFile?: string
): Promise<void> {
  const config = loadConfig();

  // 构建 pi 命令参数
  const cmd = ['pi'];
  // 核心改动：有 contextFile 时加 --fork
  if (contextFile) {
    cmd.push('--fork', contextFile);
  }

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

  // 轮询等待 Worker 就绪（替代固定 sleep）
  const readinessFile = join(homedir(), '.pi', 'tmp', `pi-in-zellij-ready-${workerPaneId}`);

  // ① 清理可能残留的旧文件（上次崩溃遗留）
  try { unlinkSync(readinessFile); } catch {}

  // ② 轮询等待 Worker 就绪
  const maxWait = (config.maxWaitSeconds || 5) * 1000;
  const pollInterval = 200;
  let elapsed = 0;
  while (!existsSync(readinessFile) && elapsed < maxWait) {
    await wait(pollInterval);
    elapsed += pollInterval;
  }
  if (!existsSync(readinessFile)) {
    ctx.ui.notify('⚠️ Worker startup timeout, attempting to send...', 'warning');
  } else {
    // ③ 检测到就绪，立即删除文件（防止残留）
    try { unlinkSync(readinessFile); } catch {}
  }
  console.log(`[pi-in-zellij] Worker readiness wait: ${elapsed}ms`);

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