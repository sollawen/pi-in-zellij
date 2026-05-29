/**
 * delegate 命令共用逻辑
 * /dd 和 /dc 都用这里导出的 delegateMsgMaker
 */

import { loadConfig } from '../config';
import { getMyPaneId } from '../lib/zellij';
import { agentList, parseAgentInput } from '../lib/agents';
import { generateCommId } from './msg-protocol';

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