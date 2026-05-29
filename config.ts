/**
 * 配置读取 — 读取并缓存 config.json
 *
 * 用户级配置路径：~/.pi/agent/pi-in-zellij.json
 *   - 首次使用：从包内 config.json 复制生成
 *   - 之后：直接读取用户级文件
 */

import { readFileSync, existsSync, copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';

export interface EditorPaneConfig {
  floating: boolean;
  pinned: boolean;
  width: string;
  height: string;
}

export interface WorkerPaneConfig {
  floating: boolean;
  pinned: boolean;
  width: string;
  height: string;
}

export interface AssistantConfig {
  alias: string;
  model: string;
}

export interface PaneCommConfig {
  names: { main: string; worker: string };
  workerPane: WorkerPaneConfig;
  editorPane: EditorPaneConfig;
  maxWaitSeconds: number;
  models: string;
  mode: string;
  assistants?: AssistantConfig[];
}

// 缓存，只读一次
let cached: PaneCommConfig | null = null;

/** 包内默认 config.json 的路径 */
const defaultConfigPath = new URL('./config.json', import.meta.url).pathname;

/** 用户级配置文件路径 */
export const userConfigFile = join(getAgentDir(), 'pi-in-zellij.json');

export function loadConfig(): PaneCommConfig {
  if (cached) return cached;

  // 首次使用：把包内默认复制到用户级
  if (!existsSync(userConfigFile)) {
    copyFileSync(defaultConfigPath, userConfigFile);
  }

  cached = JSON.parse(readFileSync(userConfigFile, 'utf-8'));
  return cached;
}

/** 清除缓存，下次 loadConfig() 重新读取磁盘 */
export function invalidateConfigCache(): void {
  cached = null;
}

/** 将配置保存到用户级配置文件（顶层键合并，保留已有字段） */
export function saveConfig(partial: Partial<PaneCommConfig>): void {
  let existing: Record<string, unknown> = {};
  if (existsSync(userConfigFile)) {
    existing = JSON.parse(readFileSync(userConfigFile, 'utf-8'));
  }

  const merged = { ...existing, ...partial };
  writeFileSync(userConfigFile, JSON.stringify(merged, null, 2) + '\n', 'utf-8');

  invalidateConfigCache();
}