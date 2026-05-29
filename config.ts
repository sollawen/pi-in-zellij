/**
 * 配置读取 — 读取并缓存 config.json
 *
 * 支持配置覆盖：
 *   优先级（高 → 低）：
 *   1. 项目级 .pi/pi-in-zellij/config.json
 *   2. 包内默认 config.json
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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
  assistants?: AssistantConfig[];  // 新增
}

// 缓存，只读一次
let cached: PaneCommConfig | null = null;

/** 包内默认 config.json 的路径（相对于本文件在包中的位置） */
const defaultConfigPath = new URL('./config.json', import.meta.url).pathname;

/** 用户项目级覆盖配置路径 */
const projectConfigPath = join(process.cwd(), '.pi', 'pi-in-zellij', 'config.json');

export function loadConfig(): PaneCommConfig {
  if (cached) return cached;

  // 1. 读取包内默认
  const defaults = JSON.parse(readFileSync(defaultConfigPath, 'utf-8'));

  // 2. 如果存在项目级覆盖，顶层键合并
  if (existsSync(projectConfigPath)) {
    const overrides = JSON.parse(readFileSync(projectConfigPath, 'utf-8'));
    cached = { ...defaults, ...overrides };
  } else {
    cached = defaults;
  }

  return cached;
}