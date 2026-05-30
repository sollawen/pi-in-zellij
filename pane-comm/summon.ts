/**
 * Summon Tool — 召唤助手到 floating pane 执行任务
 *
 * 与 dd/dc 同模式：自己拼 cmd + msg，调用 callWorker
 */

import { Type } from 'typebox';
import { StringEnum } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { loadConfig, type AssistantConfig } from '../config';
import { getMyPaneId } from '../lib/zellij';
import { generateCommId, buildMessage } from './msg-protocol';
import { callWorker } from './callWorker';

/**
 * 注册 summon tool
 *
 * @param pi - ExtensionAPI 实例
 * @param assistantsOverride - 可选，预过滤的助手列表（用于 Phase A 模型校验）
 *                              若不传则从 config.assistants 读取
 */
export function registerSummonTool(pi: ExtensionAPI, assistantsOverride?: AssistantConfig[]) {
  const config = loadConfig();
  const assistants = assistantsOverride ?? config.assistants ?? [];
  const aliases = assistants.map(a => a.alias);

  if (aliases.length === 0) return;  // 安全检查：无配置时不注册

  pi.registerTool({
    name: "summon",
    label: "Summon Assistant",
    description: "Summon an assistant to a floating pane. Only use when the user explicitly mentions an assistant's name.",
    parameters: Type.Object({
      assistant: StringEnum(aliases as [string, ...string[]], {
        description: "Assistant alias, only use when explicitly mentioned by the user"
      }) as any,
      task: Type.String({ description: "Task description to execute" }),
    }),
    promptSnippet: "Summon the specified assistant to a floating pane to execute a task",
    promptGuidelines: [
      "Only use the summon tool when the user explicitly mentions an assistant's name.",
      "When using summon, draft a complete and clear task prompt based on the conversation context.",
    ],
    async execute(toolCallId: string, params: { assistant: string; task: string }, signal: AbortSignal | undefined, onUpdate: any, ctx: ExtensionContext) {
      const { assistant, task } = params;
      // 用闭包中的 assistants，不再重新 loadConfig
      const found = assistants.find(a => a.alias === assistant);

      if (!found) {
        return {
          content: [{ type: "text", text: `Error: "${assistant}" not available. Please /summon-setup to config assistants.` }],
          details: {},
        };
      }

      // 拼 cmd（与 dd.ts 同模式，但用 assistant 的 model）
      let cmd = 'pi';
      cmd += ` --model ${found.model}`;
      if (config.mode && config.mode !== 'plan') cmd += ` --agentMode ${config.mode}`;

      // 拼 msg（secondPaneId 用占位符，callWorker 会替换为真实 ID）
      const message = buildMessage(
        getMyPaneId(),            // firstPaneId
        '__WORKER_PANE_ID__',     // secondPaneId 占位符
        config.names.main,        // firstName
        found.alias,              // secondName（用 assistant alias）
        true,                     // needReply
        generateCommId(),         // commId
        'Summon',                 // commType
        task,                     // markdown
        undefined,                // agent（summon 不指定 agent）
        process.pid,              // firstPid
        found.alias,              // assistant（新字段，Step 2 新增）
      );

      try {
        const workerPaneId = await callWorker(cmd, message, found.alias);

        return {
          content: [{ type: "text", text: `Summon: ${found.alias} is working...` }],
          details: {},
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error: Failed to summon ${found.alias}: ${err.message}` }],
          details: {},
        };
      }
    },
  });
}