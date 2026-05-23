/**
 * alt+e 外部编辑器功能
 * 创建浮动 pane 打开编辑器，退出后自动保存位置并关闭 pane
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { loadConfig } from '../config';
import { createFloatingPane } from '../lib/zellij';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PANE_NAME = 'editor-for-pi';
const saveGeoScript = join(__dirname, '..', 'lib', 'save-geo.sh');

export function registerEditorShortcut(pi: ExtensionAPI) {
  if (!('ZELLIJ' in process.env)) return;

  const editor = process.env.VISUAL || process.env.EDITOR || 'vi';

  pi.registerShortcut('alt+e', {
    description: 'Open editor in zellij pane',
    handler: async (ctx) => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'pi-zellij-editor-'));
      const tmpFile = join(tmpDir, 'buffer.md');
      const config = loadConfig();

      try {
        writeFileSync(tmpFile, ctx.ui.getEditorText(), 'utf8');

        // 脚本：编辑器退出 → 保存坐标到 geometryFile → 关闭自己
        const script = `${editor} "$1"; sh "${saveGeoScript}" editor; zellij action close-pane`;
        const quotedScript = `'${script.replace(/'/g, "'\\''")}'`;

        await createFloatingPane({
          cmd: ['sh', '-c', quotedScript, '--', tmpFile],
          geometryKey: 'editor',
          title: PANE_NAME,
          pinned: true,
          blockUntilExit: true,
          defaultWidth: config.editorPane.width,
          defaultHeight: config.editorPane.height,
        });

        // pane 已自行关闭，直接读取内容
        const content = readFileSync(tmpFile, 'utf8');
        ctx.ui.setEditorText(content);
        ctx.ui.notify('Editor content loaded', 'info');
      } catch (err) {
        ctx.ui.notify(`Editor error: ${err}`, 'error');
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  });
}
