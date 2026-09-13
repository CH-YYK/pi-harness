# Pi Profile Harness Architecture

This document describes the architectural design and subsystems of the **Pi Profile Harness**.

---

## 1. High-Level Harness Topology

The harness decouples the **Model Provider**, **Tool Registry**, **Session/Context Manager**, and the **Runtime Loop**:

```
┌────────────────────────────────────────────────────────┐
│                  Pi Profile Harness                    │
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

### Structure & Rules Organization
- **Metadata**: `profile.json` defines display names, descriptions, thinking levels, and default tool whitelists.
- **System Prompt**: `system.md` sets persona identity and primary operational directives.
- **Modular Rules**: `rules/*.md` allows organizing rules into modular files (e.g. `01-read-before-modifying.md`, `02-git-discipline.md`) that are automatically discovered and composed into the system prompt under `## Rules & Directives`.
- **Custom Tools**: `tools/*.ts` exposes profile-exclusive tools discovered and loaded at runtime.

### Loading & Dynamic Switching Lifecycle
- **Startup Resolution**: Defaults to `coder`, respects CLI flag `pi --profile <name>`, or restores previous state from session history (`profile-state` entry).
- **Runtime Interactive Switching**: `/profile-switch <profile>` or `/profile <profile>` switches the active profile on the fly with autocomplete.
- **Agent-Driven Switching**: The `switch_profile` tool enables the LLM to transition personas programmatically.
- **Dynamic Profile Creation**: The `create_profile` tool enables user and LLM to build new custom personas with tailored system prompts, rules, tools, and thinking levels.
- **KV Cache Invalidation Trade-off**:
  When a profile switch occurs, `applyProfile` updates the active profile, thinking level, and tool whitelist. On the next turn, `before_agent_start` injects the new profile's system prompt. Because prompt caching requires exact prefix matching, changing the system prompt resets the prefix KV cache for subsequent turns while unlocking multi-persona flexibility in the same session.
- **Tool Preservation**: Harness management tools (`create_profile` and `switch_profile`) are automatically maintained across tool whitelist updates.

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
