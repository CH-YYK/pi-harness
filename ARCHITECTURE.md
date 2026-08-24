# Pi Agent Harness Architecture

This document describes the architectural design and subsystems of the **Kyle Pi Agent Harness**.

---

## 1. High-Level Harness Topology

The harness decouples the **Model Provider**, **Tool Registry**, **Session/Context Manager**, and the **Runtime Loop**:

```
┌────────────────────────────────────────────────────────┐
│                   Pi Agent Harness                     │
├────────────────┬────────────────────┬──────────────────┤
│  Model Engine  │   Tool Registry    │ Session & State  │
│  (Anthropic,   │ (FS, Bash, Search, │ (Context Window, │
│  OpenAI, etc.) │  Custom Functions) │ History, Memory) │
└───────┬────────┴─────────┬──────────┴─────────┬────────┘
        │                  │                    │
        └─────────────► Agent Loop ◄────────────┘
```

- **Model Engine**: Provider abstraction handled through `@earendil-works/pi-coding-agent` (Anthropic, OpenAI, local/Ollama).
- **Tool Registry**: Dynamic tool registration (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, `obsidian_cli`, `fetch_url`, `subagent`).
- **Agent Loop**: Lifecycle execution, step budget management, and token/context sliding-window strategies.
- **Event Hooks**: `harness:init`, `turn:start`, `turn:end`, `tool:start`, `token`, `error` for observability.

---

## 2. Multi-Profile System

Profiles define personas, tool whitelists, and environment settings:

```text
profiles/
├── coder/
│   ├── profile.json         # Default model, thinking level, metadata
│   ├── system.md            # Software engineering persona prompt
│   └── tools.json           # Allowed tools: read, bash, edit, write, grep, find, ls, subagent
├── writer/
│   ├── profile.json
│   ├── system.md            # Technical writer & knowledge persistence persona
│   └── tools.json           # Allowed tools: read, write, edit, obsidian_cli, grep, find, ls
└── researcher/
    ├── profile.json
    ├── system.md            # Deep analysis & research persona
    └── tools.json           # Allowed tools: read, grep, find, ls, subagent, fetch_url
```

### Loading & Switching
- **Factory Pattern**: `ProfileLoader` parses metadata, system prompts, and tool configs.
- **CLI Switching**: `pi-harness run --profile <name>`
- **Runtime Interactive Switching**: `/switch <profile>` via `.pi/extensions/profile-switcher.ts` or `harness.switchProfile(name)`.

---

## 3. Sidecar Architecture

The harness manages background auxiliary processes across three main communication layers:

```
┌────────────────────────────────────────────────────────┐
│                   Pi Agent Harness                     │
└───────┬───────────────────┬────────────────────┬───────┘
        │ stdio / IPC       │ WebSocket / SSE    │ HTTP / RPC
        ▼                   ▼                    ▼
┌───────────────┐   ┌───────────────┐   ┌────────────────┐
│  MCP Sidecars │   │ UI / Streaming│   │ Stateful Svcs  │
│ (LSP, Linters,│   │ Sidecar (Web, │   │ (Browser, Vec- │
│  Local Tools) │   │ Obsidian IPC) │   │ tor DB, Docker)│
└───────────────┘   └───────────────┘   └────────────────┘
```

1. **MCP Sidecars**: Launch local MCP servers over stdio/SSE to discover and execute specialized tools.
2. **Process Sidecars**: Long-lived background services with `start()` and `stop()` lifecycle hooks.
3. **IPC / WebSocket Sidecars**: Bridges live agent execution events to external frontends.

---

## 4. Subagent Orchestration

- **Hierarchical Delegation**: Parent agent delegates sub-tasks using the `subagent` tool.
- **Context Isolation**: Subagents run isolated message loops and return structured summaries, preventing parent context pollution.
- **Modes**:
  - `single`: One agent, one task.
  - `parallel`: Up to 8 concurrent tasks with controlled concurrency.
  - `chain`: Sequential pipeline with `{previous}` output interpolation.

---

## 5. Evaluation Harness

The evaluation harness in `src/eval/` verifies profile constraints:
- Ensures profile personas and toolsets match expected security and capability boundaries.
- Provides test scenarios that execute across profiles in automated CI/test pipelines.
