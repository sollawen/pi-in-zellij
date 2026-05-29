/**
 * callWorker — 创建 worker pane + 等待就绪 + 发送消息
 *
 * 职责边界：
 *   - caller（dd/dc）负责拼装 cmd 字符串和 msg 字符串
 *   - callWorker 负责：创建 pane、等待就绪、写入消息
 *   - 不理解协议内容，只做纯字符串替换（__WORKER_PANE_ID__ 占位符）
 */

import { createFloatingPane, wait, writeToPane } from '../lib/zellij';
import { loadConfig } from '../config';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * 创建 worker pane，等待就绪，发送消息
 *
 * @param cmd       在 worker pane 中执行的完整命令字符串（如 'pi --model xxx'）
 * @param msg       要发送给 worker 的完整消息字符串（secondPaneId 处用 __WORKER_PANE_ID__ 占位）
 * @param workerName 用作 pane title（geometryKey 固定为 'worker'，与保存的位置数据一致）
 * @returns workerPaneId
 */
export async function callWorker(
  cmd: string,
  msg: string,
  workerName: string,
): Promise<string> {
  const config = loadConfig();

  // 1. 创建 worker pane
  const taggedCmd = `bash -c 'PI_FLOATING_WORKER=1 ${cmd}'`;
  const workerPaneId = await createFloatingPane({
    cmd: taggedCmd,
    geometryKey: workerName,
    title: workerName,
    pinned: true,
    defaultWidth: config.workerPane.width,
    defaultHeight: config.workerPane.height,
  });

  // 2. 清理可能残留的旧 ready 文件
  const readinessFile = join(homedir(), '.pi', 'tmp', `pi-in-zellij-ready-${workerPaneId}`);
  try {
    unlinkSync(readinessFile);
  } catch (e: any) {
    if (e.code !== 'ENOENT') throw e; // 文件不存在可以忽略，其他错误往上抛
  }

  // 3. 轮询等待 Worker 就绪
  const maxWait = (config.maxWaitSeconds || 5) * 1000;
  const pollInterval = 200;
  let elapsed = 0;
  while (!existsSync(readinessFile) && elapsed < maxWait) {
    await wait(pollInterval);
    elapsed += pollInterval;
  }

  // 4. 就绪后删除文件（防止残留）
  try {
    unlinkSync(readinessFile);
  } catch (e: any) {
    if (e.code !== 'ENOENT') throw e;
  }

  // 5. 占位符替换：填入真实的 workerPaneId
  const finalMsg = msg.replace('__WORKER_PANE_ID__', workerPaneId);

  // 6. 发送消息
  await writeToPane(workerPaneId, finalMsg);

  return workerPaneId;
}