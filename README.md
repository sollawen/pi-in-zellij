# pi-in-zellij — Pi, now in Zellij 🖥️✨

## Why?

**Pi only supports tmux out of the box.** But let's be honest — Zellij is just *gorgeous*. Floating panes, smooth UX, modern feel. Tmux who?

So I built this extension to bring Pi into Zellij, and things got a lot more interesting along the way.

---

## What can it do?

### 🖊️ `alt+e` — Floating editor pane

Hit `alt+e` and a floating editor pane appears right in your terminal. Edit code or notes while keeping Pi's full context visible beside you. No more alt-tabbing to a separate editor. No more losing your train of thought.

Close the pane when you're done — your edits come right back into Pi's input. It's just *nice*.

### 🔄 `/delegate` & `/dd` — Two Pies are better than one

This is the real deal. Pi spawns *another Pi* in a floating pane, and they talk to each other over a tiny protocol.

| Command | What it does |
|---------|--------------|
| `/delegate <task>` | Tell the main Pi "help me write a prompt for this task", then it sends the polished prompt to a Worker Pi |
| `/dd [agentName] <task>` | **D**irect **D**elegate — skip the prompt-polishing, send the task straight to the Worker |

**Why would you want this?**

- 🧠 Your main Pi runs the expensive, smart model. It thinks, plans, and coordinates.
- 💪 The Worker Pi runs a cheaper model. It does the grunt work — searching code, writing boilerplate, reviewing PRs, checking types.
- 🚫 **No context pollution.** The Worker's conversation stays in its own pane. Your main Pi's context stays clean and focused. Fewer tokens burned on irrelevant chitchat.
- 👁️ **Full visibility.** Every Worker output streams in front of you. See what it's doing. Interrupt it if it goes off the rails.
- 🎯 **Agent-ready.** If you have custom agents (defined in `.pi/agents/`), you can assign them to the Worker: `/dd code-reviewer "review this PR"`

### 💾 Geometry memory

Pi remembers where you like your floating panes. Close a pane, open it again later — it comes back exactly where you left it. Pane positions are saved per-pane-type (editor vs. worker), stored in `~/.pi/tmp/zellij-geometry`.

---

## Quick start

```bash
pi install npm:pi-in-zellij
```

That's it. Restart Pi and you're ready.

---

## Configuration

Want to customize? Create `.pi/pi-in-zellij/config.json` in your project root. Any field you set overrides the default — the rest stays as-is.

**Example — use a cheap model for the Worker:**

```json
{
  "models": "google/gemini-2.5-flash",
  "mode": "work"
}
```

### All config options

| Field | Default | What it does |
|-------|---------|--------------|
| `names.main` | `"Main"` | Name tag for the orchestrating Pi |
| `names.worker` | `"Lisa"` | Name tag for the Worker Pi |
| `workerPane.width` | `"25%"` | Width of the floating Worker pane |
| `workerPane.height` | `"60%"` | Height of the floating Worker pane |
| `editorPane.width` | `"40%"` | Width of the floating editor pane |
| `editorPane.height` | `"70%"` | Height of the floating editor pane |
| `startupWaitSeconds` | `1` | Seconds to wait for Pi to boot in the Worker pane (tune for slow machines) |
| `models` | `"minimax-cn/MiniMax-M2.7"` | Model for the Worker. Set to `"auto"` to use Pi's default |
| `mode` | `"work"` | Agent mode for the Worker (`"plan"` or `"work"`) |

---

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `alt+e` | Open floating editor pane |

---

## Commands

| Command | Action |
|---------|--------|
| `/delegate <task>` | Ask Pi to craft a prompt, then send it to a Worker |
| `/dd [agentName] <task>` | Send a task directly to a Worker, no middleman |

Pro tip: Combine `/dd` with custom agents. List your available agents with `pi list --agents` or just type `/dd` and hit tab to see autocomplete.

---

## Requirements

- [Zellij](https://zellij.dev) — you're using it, right?
- [Pi](https://pi.dev) — obviously
- A terminal that supports floating panes (Zellij does by default)

---

## Under the hood (for the curious)

Pi-in-zellij works by spawning Pi processes in floating Zellij panes. They communicate through a lightweight XML protocol sent as keystrokes — no sockets, no files, no daemons. Just two Pi instances chatting through the terminal.

---

*Made because Zellij deserves first-class Pi support. Feedback and contributions welcome!*

Solla Wen
email: sollawen@163.com
