/**
 * 传输层 — 所有 zellij 操作的唯一出入口
 * geometry 是内部实现，上层通过 geometryKey 透明使用
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const execAsync = promisify(exec);

// ---- geometry 存储（合并为一个文件，支持多 key）----

const geometryDir = join(homedir(), '.pi', 'tmp');
const geometryFile = join(geometryDir, 'zellij-geometry');

interface PaneGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

type GeometryStore = Record<string, PaneGeometry>;

const geoLineRe = /^\[(\w+)\]\s*x:(\d+),\s*y:(\d+),\s*w:(\d+),\s*h:(\d+)/;

function loadGeometryStore(): GeometryStore {
  const store: GeometryStore = {};
  try {
    if (!existsSync(geometryFile)) return store;
    const lines = readFileSync(geometryFile, 'utf8').split('\n');
    for (const line of lines) {
      const m = line.match(geoLineRe);
      if (m) {
        store[m[1]] = { x: +m[2], y: +m[3], width: +m[4], height: +m[5] };
      }
    }
  } catch {
    // 静默忽略
  }
  return store;
}

function saveGeometryStore(store: GeometryStore) {
  try {
    mkdirSync(geometryDir, { recursive: true });
    const lines = Object.entries(store)
      .map(([k, g]) => `[${k}] x:${g.x}, y:${g.y}, w:${g.width}, h:${g.height}`);
    writeFileSync(geometryFile, lines.join('\n') + '\n', 'utf8');
  } catch {
    // 静默忽略
  }
}

/** 加载指定 key 的 geometry（内部使用） */
function loadGeometry(key: string): PaneGeometry | null {
  const store = loadGeometryStore();
  const raw = store[key];
  if (!raw) return null;
  if (
    typeof raw.x === 'number' && typeof raw.y === 'number' &&
    typeof raw.width === 'number' && typeof raw.height === 'number' &&
    raw.width > 0 && raw.height > 0
  ) {
    return raw;
  }
  return null;
}

/** 保存指定 key 的 geometry（内部使用） */
function saveGeometry(key: string, geo: PaneGeometry) {
  const store = loadGeometryStore();
  store[key] = geo;
  saveGeometryStore(store);
}

/** 查询 pane 位置并保存到指定 key（内部使用） */
async function savePaneGeometryByKey(key: string, paneId: string): Promise<void> {
  try {
    const [panesRes, tabRes] = await Promise.all([
      execAsync('zellij action list-panes --json'),
      execAsync('zellij action current-tab-info -j'),
    ]);
    const panes = JSON.parse(panesRes.stdout);
    const tab = JSON.parse(tabRes.stdout);
    const tabW = tab.viewport_columns;
    const tabH = tab.viewport_rows;
    const numericId = paneId.replace('terminal_', '');
    const pane = panes.find(
      (p: any) => String(p.id) === numericId && p.is_floating === true
    );
    if (!pane) return;

    const pct = (v: number, total: number) => Math.round((v / total) * 100);
    saveGeometry(key, {
      x: pct(pane.pane_x, tabW),
      y: pct(pane.pane_y, tabH),
      width: pct(pane.pane_columns, tabW),
      height: pct(pane.pane_rows, tabH),
    });
  } catch {
    // 静默忽略
  }
}

// ---- 公开 API ----

/** 检查当前是否运行在 zellij 中 */
export function isInZellij(): boolean {
  return !!process.env.ZELLIJ_PANE_ID;
}

/** 获取当前进程所在的 pane-id（terminal_n 格式） */
export function getMyPaneId(): string {
  const id = process.env.ZELLIJ_PANE_ID;
  if (!id) throw new Error('ZELLIJ_PANE_ID 环境变量不存在，可能不在 zellij 中运行');
  return `terminal_${id}`;
}

/**
 * 创建浮动 pane
 * @param opts.cmd 要在 pane 中执行的命令
 * @param opts.geometryKey 有值时自动恢复上次位置，下次 create 时用保存的 x/y/width/height
 * @param opts.title pane 标题
 * @param opts.pinned 是否钉住
 * @param opts.blockUntilExit true = 阻塞等待命令退出（editor 用）；false = 立即返回（worker 用）
 * @param opts.defaultWidth geometry 无记录时的默认宽度（如 '40%'）
 * @param opts.defaultHeight geometry 无记录时的默认高度（如 '70%'）
 */
export async function createFloatingPane(opts: {
  cmd: string[];
  geometryKey?: string;
  title?: string;
  pinned?: boolean;
  blockUntilExit?: boolean;
  defaultWidth?: string;
  defaultHeight?: string;
}): Promise<string> {
  const geo = opts.geometryKey ? loadGeometry(opts.geometryKey) : null;

  const args: string[] = ['run'];

  if (opts.title) {
    args.push('--name', `"${opts.title}"`);
  }
  args.push('--floating');
  if (opts.pinned) {
    args.push('--pinned', 'true');
  }
  if (opts.blockUntilExit) {
    args.push('--block-until-exit');
  }

  if (geo) {
    args.push('--x', `${geo.x}%`, '--y', `${geo.y}%`);
    args.push('--width', `${geo.width}%`, '--height', `${geo.height}%`);
  } else {
    if (opts.defaultWidth) args.push('--width', opts.defaultWidth);
    if (opts.defaultHeight) args.push('--height', opts.defaultHeight);
  }

  args.push('--', ...opts.cmd);

  const { stdout } = await execAsync(['zellij', ...args].join(' '));
  const paneId = stdout.trim();

  return paneId;
}

/**
 * 关闭浮动 pane
 * @param paneId 要关闭的 pane-id
 * @param geometryKey 有值时自动保存当前 pane 位置
 */
export async function closeFloatingPane(paneId: string, geometryKey?: string): Promise<void> {
  if (geometryKey) {
    await savePaneGeometryByKey(geometryKey, paneId);
  }
  await closePane(paneId);
}

/** 发送文本到目标 pane（清空输入框 → 写入 → 回车） */
export async function writeToPane(paneId: string, text: string): Promise<void> {
  await execAsync(`zellij action send-keys -p ${paneId} "Ctrl u"`);
  await new Promise(r => setTimeout(r, 100));

  const escaped = text.replace(/'/g, "'\\''");
  await execAsync(`zellij action write-chars -p ${paneId} '${escaped}'`);
  await execAsync(`zellij action send-keys -p ${paneId} Enter`);
}

/** 检查指定 pane 是否还存在 */
export async function isPaneAlive(paneId: string): Promise<boolean> {
  try {
    const { stdout } = await execAsync('zellij action list-panes --json');
    const panes = JSON.parse(stdout);
    return panes.some((p: any) => `terminal_${p.id}` === paneId);
  } catch {
    return false;
  }
}

/** 关闭指定 pane（内部使用） */
async function closePane(paneId: string): Promise<void> {
  await execAsync(`zellij action close-pane -p ${paneId}`);
}

/** 等待指定毫秒 */
export function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}