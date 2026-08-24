# pi-harness

Modular profile management system & persona harness for the **[Pi Coding Agent](https://github.com/earendil-works/pi-coding-agent)**. Part of the **[Pi-Agent Project](https://github.com/users/CH-YYK/projects/1)** ecosystem.

---

## 🌟 Features

1. **Session-Locked Startup Profile Pattern**:
   * Activate personas via `pi --profile <name>` (or configure via session state).
   * Profiles remain immutable across the session, guaranteeing 100% KV prefix cache hits on Claude 3.7 / Gemini 2.5 / GPT-4.5.
2. **Prebuilt & Custom Profile Discovery**:
   * Bundled prebuilt personas: `profiles/coder/` (software architecture, implementation, refactoring, test execution).
   * Custom personas auto-discovered from `~/.pi/agent/profiles/`, `~/.pi/profiles/`, or `<project>/.pi/profiles/`.
3. **Dynamic Profile-Scoped Tools**:
   * Tools defined in `profiles/<profile_name>/tools/*.ts` are dynamically loaded and scoped exclusively to that persona whitelist.
4. **Slash Commands**:
   * `/profiles` — Inspect all discovered prebuilt and custom profiles.
   * `/profile` — View current session's locked profile configuration and toolset.

---

## 📦 Installation

Install into your global Pi configuration (`~/.pi/agent/settings.json`):

```json
{
  "packages": [
    "git:github.com/CH-YYK/pi-harness"
  ]
}
```

Or test transiently:
```bash
pi --extension /path/to/pi-harness/index.ts
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

---

## 🧪 Testing

```bash
npm run verify
```
