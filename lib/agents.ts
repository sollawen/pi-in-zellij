/**
 * Agent 模块 — walk-up 搜索 + 模块级列表构建
 * 搜索优先级：cwd → 逐级向上 → 全局目录
 * 同名 agent 就近覆盖
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

/**
 * 从 cwd 逐级向上收集所有 .pi/agents 目录路径（不含全局目录）
 */
function walkUpAgentDirs(): string[] {
  const dirs: string[] = [];
  let current = process.cwd();
  while (true) {
    const dir = join(current, '.pi', 'agents');
    if (existsSync(dir)) dirs.push(dir);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return dirs;
}

/**
 * 获取全局 agent 目录列表
 */
function globalAgentDirs(): string[] {
  return [
    join(homedir(), '.pi', 'agent', 'agents'),
  ];
}

/**
 * 遍历所有搜索目录，构建 name → fullPath 映射
 * 搜索顺序：cwd → 向上 → 全局（后面的覆盖前面的同名）
 */
export function buildAgentList(): Map<string, string> {
  const map = new Map<string, string>();

  // 先全局（被项目覆盖）
  for (const dir of globalAgentDirs()) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''))) {
      map.set(name, join(dir, `${name}.md`));
    }
  }

  // 再项目级（覆盖全局同名）
  // 反向迭代：最近目录最后处理，值覆盖前面的同名记录
  for (const dir of [...walkUpAgentDirs()].reverse()) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''))) {
      map.set(name, join(dir, `${name}.md`));
    }
  }

  return map;
}

/** 模块加载时扫描一次 */
export const agentList = buildAgentList();

/**
 * 读取指定 agent 的内容
 * @param name agent 名称
 * @returns agent 文件内容，如果不存在则返回 null
 */
export function readAgent(name: string): string | null {
  const filePath = agentList.get(name);
  if (filePath && existsSync(filePath)) {
    return readFileSync(filePath, 'utf-8');
  }
  return null;
}

export interface ParsedInput {
  agent?: string;
  task: string;
}

/**
 * 解析用户输入，提取 agent 名称和任务
 * @param userInput 原始输入
 * @param agentsList 可用 agent 列表
 * @returns 解析结果
 */
export function parseAgentInput(userInput: string, agentsList: string[]): ParsedInput {
  const parts = userInput.split(' ');
  const firstWord = parts[0];
  const agent = agentsList.includes(firstWord) ? firstWord : undefined;
  const task = agent ? parts.slice(1).join(' ') : userInput;
  return { agent, task };
}