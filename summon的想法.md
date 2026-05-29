# 我有一个好玩的想法。

做一个tool summon，专门用来创建一个 floating pane and run pi inside it. 这个tool给main pi LLM用。

## model alias

通常我有两个主力的LLM，一个比较贵但聪明，一个比较便宜但是笨。

我们在 config.json 里面给它俩起个alias
{
	assistants: [
		{alias:"Lisa", model:"minimax-cn/MiniMax-M2.7:medium"},
		{alias:"Jackey", model:"zai/glm-5.1:high"},
	] 
}


## summon to an assistants

- 当然我觉得需要分派给 worker pi 的时候,我就说
	- 让Jackey来执行这个计划吧
	- 可以让Lisa来搜索一下相关的资料
	- 让Lisa来查代现在的代码,是否能实现我们的想法
- main LLM 一看,就知道了,就根据session的对话context,起草一段给assistant的prompt,然后使用和/dd同样的方法，发到 working pane 里面去

## 触发控制（关键）

- 只有用户明确说了助手名字（Lisa/Jackey），main LLM 才能使用 summon
- 用户没提名字 → 不允许使用
- 实现方式：`assistant` 参数用 **StringEnum**，值从 config.assistants 动态生成（不硬编码）
- **没配 assistants → summon tool 根本不注册**，LLM 看不到这个工具，零副作用
- 注册判断在 `index.ts` 里：`if (config.assistants?.length) registerSummonTool(pi)`

你觉得这样好玩不好玩?

---

# 初步思路

## 整体架构

用户:"让Lisa执行这个计划"
- main LLM:根据上下文起草 prompt
- summon tool:建 pane,发消息
	- 消息的 commType = summon
	- 消息协议里面，用 `<assistant>` 标签指定 alias
		`<assistant: Lisa>`
	
Lisa(worker LLM):
- 发现是 commType= summon
- 直接执行 prompt（model 已由 main 侧启动时通过 --model 指定）
- 执行完成，返回结果

### 两层 LLM 各司其职

- **main LLM**:理解用户意图 + 整理上下文 + 写 prompt
- **worker LLM (Lisa)**:读任务 + 使用对应的LLM + 执行

### commType 区分任务来源

| 来源 | commType | worker 行为 |
|---|---|---|
| `/dd` `/dc` 命令 | `Delegate` | 原有流程，直接执行 |
| summon tool（Lisa） | `Summon` | 带 assistant alias |
