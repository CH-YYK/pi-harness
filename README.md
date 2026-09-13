# pi-profile-harness

Modular profile management system & persona harness for the **[Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent)**. Part of the **[Pi-Agent Project](https://github.com/users/CH-YYK/projects/1)** ecosystem.

---

## 🌟 Features

1. **Flexible Profile Activation & Dynamic Switching**:
   * Activate personas at startup via `pi --profile <name>` (default: `coder`).
   * Switch active profiles on the fly mid-session via `/profile-switch <name>`, `/profile <name>`, or the `switch_profile` tool.
   * *Note on KV Caching*: Starting with a fixed profile preserves 100% KV prefix cache hits across turns. Switching profiles mid-session hot-swaps the system prompt and tool whitelist, resetting the prefix cache for subsequent turns to afford maximum multi-persona flexibility.
2. **Prebuilt & Custom Profile Discovery**:
   * Bundled prebuilt personas: `profiles/coder/` (software architecture, implementation, refactoring, test execution).
   * Custom personas auto-discovered from `~/.pi/agent/profiles/`, `~/.pi/profiles/`, or `<project>/.pi/profiles/`.
3. **Modular Rule Organization**:
   * Prompts can be composed of both `system.md` and modular rule files under `profiles/<profile_name>/rules/*.md`, cleanly organizing directives and constraints.
4. **Dynamic Profile Tools**:
   * `create_profile`: Create new custom personas with tailored system prompts, modular rules, thinking levels, and tool whitelists.
   * `switch_profile`: LLM-callable tool to transition between personas dynamically.
   * Profile-exclusive tools (e.g., `profiles/coder/tools/git_status.ts`) dynamically discovered and scoped to persona whitelists.
5. **Interactive Slash Commands**:
   * `/profiles` — Inspect all discovered prebuilt and custom profiles.
   * `/profile [name]` — View active session profile details or switch to a target profile.
   * `/profile-switch <name>` — Directly switch profiles with argument autocompletion.

---

## 📦 Installation

### Git (Recommended)
Install into your global Pi configuration (`~/.pi/agent/settings.json`):

```json
{
  "packages": [
    "git:github.com/CH-YYK/pi-profile-harness"
  ]
}
```

Or test transiently:
```bash
pi --extension /path/to/pi-profile-harness/index.ts
```

---

## 🚀 Usage

```bash
# Launch with default coder profile
pi

# Launch with a specific profile
pi --profile coder
```

Inside an interactive session:
* `/profiles` — List all discovered profiles
* `/profile` — Show active session profile details
* `/profile <name>` or `/profile-switch <name>` — Switch active profile persona and toolset mid-session
* Call `create_profile` via the agent — Create and register a new persona on the fly
* Call `switch_profile` via the agent — Seamlessly transition personas programmatically

---

## 🧪 Testing

```bash
npm run verify
```
