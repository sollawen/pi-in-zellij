/**
 * 协议层 — XML 编解码，纯函数，零 I/O
 * 不 import 任何带副作用的模块
 */

export interface PiMessage {
  firstPaneId: string;
  secondPaneId: string;
  firstName: string;
  secondName: string;
  needReply: boolean;
  commId: string;
  commType: string;
  agent?: string;
  firstPid?: number;
  markdown: string;
}

/** 判断是否是协议消息 */
export function isProtocolMessage(input: string): boolean {
  return input.startsWith('<pi-communication>');
}

/** 解析协议消息 */
export function parseMessage(input: string): PiMessage | null {
  if (!isProtocolMessage(input)) return null;

  const firstPaneId = extractField(input, 'firstPaneId');
  const secondPaneId = extractField(input, 'secondPaneId');
  const firstName = extractField(input, 'firstName');
  const secondName = extractField(input, 'secondName');
  const needReplyRaw = extractField(input, 'needReply');
  const commId = extractField(input, 'commId');
  const commType = extractField(input, 'commType');
  const agent = extractField(input, 'agent');
  const firstPidRaw = extractField(input, 'firstPid');
  const markdown = extractMarkdown(input);

  if (!firstPaneId || !secondPaneId || !firstName) return null;

  return {
    firstPaneId,
    secondPaneId,
    firstName,
    secondName: secondName || '',
    needReply: needReplyRaw === 'true',
    commId: commId || '',
    commType: commType || 'Delegate',
    agent: agent || undefined,
    firstPid: firstPidRaw ? parseInt(firstPidRaw, 10) : undefined,
    markdown,
  };
}

/** 构造协议消息 */
export function buildMessage(
  firstPaneId: string,
  secondPaneId: string,
  firstName: string,
  secondName: string,
  needReply: boolean,
  commId: string,
  commType: string,
  markdown: string,
  agent: string | undefined = undefined,
  firstPid: number | undefined = undefined
): string {
  const agentLine = agent !== undefined
    ? `    <agent: ${agent}>`
    : `    <agent: >`;
  const firstPidLine = firstPid !== undefined
    ? `    <firstPid: ${firstPid}>`
    : `    <firstPid: >`;

  return [
    '<pi-communication>',
    `    <firstPaneId: ${firstPaneId}>`,
    `    <secondPaneId: ${secondPaneId}>`,
    `    <firstName: ${firstName}>`,
    `    <secondName: ${secondName}>`,
    `    <needReply: ${needReply}>`,
    `    <commId: ${commId}>`,
    `    <commType: ${commType}>`,
    agentLine,
    firstPidLine,
    '    <markdown>',
    `        ${markdown}`,
    '    </markdown>',
    '</pi-communication>',
  ].join('\n');
}

/** 用机器时间戳后6位生成通信 ID */
export function generateCommId(): string {
  return (Date.now() % 1000000).toString();
}

// --- 内部工具函数 ---

function extractField(input: string, field: string): string | null {
  const match = input.match(new RegExp(`<${field}:\\s*(.+?)>`));
  return match ? match[1].trim() : null;
}

function extractMarkdown(input: string): string {
  const match = input.match(/<markdown>\s*([\s\S]*?)\s*<\/markdown>/);
  return match ? match[1].trim() : '';
}