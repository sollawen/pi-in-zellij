# Main-Pi thinks, Worker-Pi works.

- **Main-Pi** runs the expensive, smart model — it thinks, plans, and coordinates
- **Worker-Pi** run cheaper models — searching code, writing boilerplate, reviewing PRs, checking types
- **No context pollution** — Worker-Pi runs in his own pane, main-Pi stays clean
- **Full visibility** — every Pi output streams in front of you. Interrupt if needed.

---

## Where are Agents

Compatible with the most popular pi package "pi-subagents", we scan agents' markdown files in this order:

1. **Global** `~/.pi/agent/agents/` — shared across all projects
2. **Project** — walk up from your current directory:
```
./ .pi/agents/
../ .pi/agents/
../../ .pi/agents/
...
```

**Priority:** Project agents override global agents. Nearer project directories win over farther ones.


---

## Agent File Format
`code-reviewer.md`
```
name: code-reviewer
description: Reviews code for bugs, style, and best practices
tools: read, grep, find
model: claude-sonnet-4
---

You are a senior code reviewer...
```

- **filename** — how you call it in `/dd` or `/dc`
- **description** — shown in autocomplete
- **tools** — optional, what tools the agent can use
- **model** — optional, defaults to your config

The rest is the agent's system prompt in Markdown.

---

## Delegation Commands

| Command | Behavior | Example |
|---------|----------|---------|
| `/dd [agentName] <task>` | Direct — no context shared | `/dd code-reviewer "review this PR"` |
| `/dc [agentName] <task>` | With full Context | `/dc "fix this bug, here's the context..."` |

Type `/dd` or `/dc` and hit **Tab** to see available agents.
