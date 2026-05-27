/**
 * 输入截获 + agent_end hook
 * 截获来自其他 pi 的协议消息，处理需要回复/不需要回复的场景
 * Worker 完成任务后自动回复并关闭 pane
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { getMyPaneId, writeToPane, closeFloatingPane } from '../lib/zellij';
import { PiMessage, isProtocolMessage, parseMessage, buildMessage } from './msg-protocol';
import { readAgent } from '../lib/agents';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// 当前任务元数据（Worker 收到委托时设置，回复后清除）
let currTask: (Omit<PiMessage, 'markdown'> & { receivedAt: number }) | null = null;

/** 检查指定 PID 的进程是否存活 */
function isProcessAlive(pid: number | null | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0); // signal 0 = 只检查存在性，不发送信号
    return true;
  } catch {
    return false;
  }
}

/** 从 sessionManager 取最新 assistant 消息的文本 */
function getLatestAssistantText(ctx: any): string {
  try {
    const leaf = ctx.sessionManager.getLeafEntry() as any;
    return leaf?.message?.role === 'assistant'
      ? leaf.message.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('')
      : '';
  } catch (err) {
    console.log('[pi-in-zellij] getLeafEntry 取回复文本失败:', err);
    return '';
  }
}

export function registerInterceptor(pi: ExtensionAPI) {

  // ---- session_start：pi 完全就绪后写入就绪文件 ----
  pi.on('session_start', () => {
    try {
      const piTmpDir = join(homedir(), '.pi', 'tmp');
      mkdirSync(piTmpDir, { recursive: true });
      const readinessFile = join(piTmpDir, `pi-in-zellij-ready-${getMyPaneId()}`);
      writeFileSync(readinessFile, 'ready', 'utf8');
    } catch (err) {
      console.error('[pi-in-zellij] failed to write readiness file:', err);
    }
  });

  // ---- input hook：截获来自其他 pi 的协议消息 ----
  pi.on('input', async (event, ctx) => {
    if (event.source === 'extension') return { action: 'continue' };
    if (!isProtocolMessage(event.text)) return { action: 'continue' };

    const message = parseMessage(event.text);
    if (!message) return { action: 'continue' };

    // 根据 commType 判断谁是实际发送方
    const fromName = (message.commType === 'Report' || message.commType === 'Info')
      ? message.secondName   // Report/Info 是 second 发的
      : message.firstName;   // Delegate/Chat 是 first 发的

    // 处理 agent（如果有的话）
    let agentContent: string | null = null;
    if (message.agent && message.agent !== '') {
      agentContent = readAgent(message.agent);
      if (agentContent) {
        ctx.ui.notify(`📋 已加载 agent: ${message.agent}`, 'info');
      } else {
        ctx.ui.notify(`⚠️ Agent "${message.agent}" 读取失败`, 'warning');
      }
    }

    // 组合内容发给 LLM
    const enhancedContent = agentContent
      ? `${agentContent}\n\n---\n**任务:**\n\n${message.markdown}`
      : message.markdown;

    // 不需要回复 → 转为普通输入送给 LLM
    if (!message.needReply) {
      return {
        action: 'transform',
        text: `[来自 ${fromName} 的${message.commType}]\n${enhancedContent}`,
      };
    }

    // 需要回复 → 记录发送方，把任务送给 LLM
    ctx.ui.notify(`📨 收到来自 ${fromName} 的${message.commType}`, 'info');

    currTask = {
      firstPaneId: message.firstPaneId,
      secondPaneId: message.secondPaneId,
      firstName: message.firstName,
      secondName: message.secondName,
      needReply: message.needReply,
      commId: message.commId,
      commType: message.commType,
      firstPid: message.firstPid,
      receivedAt: Date.now(),
    };

    pi.sendUserMessage(`[来自 ${fromName} 的${message.commType}]\n${enhancedContent}`);
    return { action: 'handled' };
  });

  // ---- agent_end hook：LLM 完成后自动回复 + 关闭 ----
  pi.on('agent_end', async (_event, _ctx) => {
    // Worker 侧：回复给 Main 并关闭
    if (!currTask) return;

    // 立刻快照 + 清除，防止重复触发
    const task = { ...currTask };
    currTask = null;

    try {
      const replyText = getLatestAssistantText(_ctx);

      if (replyText) {
        // 检查发起方进程是否存活（而非仅检查 pane 是否存在）
        if (!isProcessAlive(task.firstPid)) {
          console.log('[pi-in-zellij] 发起方进程已退出，放弃回复');
          // 不 return，继续走到 finally 关闭自己
        } else {
          const replyMessage = buildMessage(
            task.firstPaneId,
            task.secondPaneId,
            task.firstName,
            task.secondName,
            false,
            task.commId,
            'Report',
            replyText
          );

          // 回复给 first（发起方）
          await writeToPane(task.firstPaneId, replyMessage);
        }
      }
    } catch (err) {
      console.log('[pi-in-zellij] 回复失败:', err);
    } finally {
      // 保存当前 pane 位置，然后关闭（无论是否成功回复）
      await closeFloatingPane(getMyPaneId(), 'worker');
    }
  });
}