/**
 * Pi Harness Extension (pi_harness)
 *
 * Self-contained profile management system:
 * 1. Bundled prebuilt profiles: `extensions/pi_harness/profiles/<profile_name>/`
 * 2. User custom profiles: `~/.pi/agent/profiles/`, `~/.pi/profiles/`, `<cwd>/.pi/profiles/`
 * 3. Profile-exclusive tools: `profiles/<profile_name>/tools/*.ts`
 *
 * Design Principles:
 * - Dynamic Profile Switching: Profiles can be selected at startup (`pi --profile <name>`)
 *   or switched on the fly mid-session via `/switch <name>`, `/profile <name>`, or the `switch_profile` tool.
 * - System Prompt & Toolset Hot-Swapping: Switching dynamically updates the active system prompt,
 *   profile-exclusive tool whitelist, and thinking level. Note: Changing the system prompt between turns
 *   resets the prefix KV cache for subsequent turns.
 * - Profile Creation Tool: Create new custom profiles on the fly via `create_profile`.
 * - Rule-based Modular Organization: Profiles organize system prompts and modular rules under `rules/*.md`.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

interface ProfileMeta {
  name: string;
  displayName: string;
  description: string;
  defaultThinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  tools: string[];
}

export interface Profile {
  name: string;
  meta: ProfileMeta;
  systemPrompt: string;
  isCustom: boolean;
  sourceDir: string;
  toolFiles: string[];
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Scan and load all available profiles.
 * Priority: Prebuilt -> Global Custom -> Project Custom
 */
export function loadAllProfiles(cwd: string): Map<string, Profile> {
  const profileMap = new Map<string, Profile>();

  // 1. Prebuilt Profiles inside extension package
  const prebuiltDir = path.join(__dirname, "profiles");
  scanProfileDir(prebuiltDir, false, profileMap);

  // 2. Global Custom Profiles (~/.pi/profiles, ~/.pi/agent/profiles)
  const agentDir = getAgentDir();
  scanProfileDir(path.join(os.homedir(), ".pi", "profiles"), true, profileMap);
  scanProfileDir(path.join(agentDir, "profiles"), true, profileMap);

  // 3. Environment override
  if (process.env.PI_PROFILES_DIR) {
    scanProfileDir(process.env.PI_PROFILES_DIR, true, profileMap);
  }

  // 4. Project-Local Custom Profiles (<cwd>/.pi/profiles, <cwd>/profiles)
  scanProfileDir(path.join(cwd, CONFIG_DIR_NAME, "profiles"), true, profileMap);
  scanProfileDir(path.join(cwd, "profiles"), true, profileMap);

  return profileMap;
}

function scanProfileDir(dir: string, isCustom: boolean, map: Map<string, Profile>) {
  if (!fs.existsSync(dir)) return;

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const profilePath = path.join(dir, entry.name);
    const metaPath = path.join(profilePath, "profile.json");
    const systemPromptPath = path.join(profilePath, "system.md");
    const toolsPath = path.join(profilePath, "tools.json");

    let meta: ProfileMeta = {
      name: entry.name,
      displayName: entry.name.toUpperCase(),
      description: `Profile for ${entry.name}`,
      tools: ["read", "bash", "edit", "write"],
    };

    if (fs.existsSync(metaPath)) {
      try {
        meta = { ...meta, ...JSON.parse(fs.readFileSync(metaPath, "utf-8")) };
      } catch {
        // ignore
      }
    }

    if (fs.existsSync(toolsPath)) {
      try {
        const toolsConfig = JSON.parse(fs.readFileSync(toolsPath, "utf-8"));
        if (Array.isArray(toolsConfig.allowedTools)) {
          meta.tools = toolsConfig.allowedTools;
        }
      } catch {
        // ignore
      }
    }

    let systemPrompt = "";
    if (fs.existsSync(systemPromptPath)) {
      try {
        systemPrompt = fs.readFileSync(systemPromptPath, "utf-8").trim();
      } catch {
        // ignore
      }
    }

    // Discover modular rules inside profiles/<profile_name>/rules/*.md
    const rulesDir = path.join(profilePath, "rules");
    if (fs.existsSync(rulesDir)) {
      try {
        const ruleEntries = fs.readdirSync(rulesDir, { withFileTypes: true });
        const ruleFiles = ruleEntries
          .filter((re) => re.isFile() && re.name.endsWith(".md"))
          .map((re) => re.name)
          .sort();
        const ruleTexts: string[] = [];
        for (const rf of ruleFiles) {
          try {
            const rfPath = path.join(rulesDir, rf);
            const content = fs.readFileSync(rfPath, "utf-8").trim();
            if (content) {
              ruleTexts.push(content);
            }
          } catch {
            // ignore
          }
        }
        if (ruleTexts.length > 0) {
          const rulesBlock = ruleTexts.join("\n\n");
          systemPrompt = systemPrompt
            ? `${systemPrompt}\n\n## Rules & Directives\n${rulesBlock}`
            : `## Rules & Directives\n${rulesBlock}`;
        }
      } catch {
        // ignore
      }
    }

    // Discover profile-scoped custom tools inside profiles/<profile_name>/tools/
    const profileToolsDir = path.join(profilePath, "tools");
    const toolFiles: string[] = [];
    if (fs.existsSync(profileToolsDir)) {
      try {
        const toolEntries = fs.readdirSync(profileToolsDir, { withFileTypes: true });
        for (const te of toolEntries) {
          if (
            te.isFile() &&
            (te.name.endsWith(".ts") || te.name.endsWith(".js") || te.name.endsWith(".mjs")) &&
            !te.name.endsWith(".d.ts") &&
            !te.name.endsWith(".test.ts") &&
            !te.name.endsWith(".spec.ts")
          ) {
            toolFiles.push(path.join(profileToolsDir, te.name));
          }
        }
      } catch {
        // ignore
      }
    }

    const existing = map.get(entry.name);

    if (existing) {
      map.set(entry.name, {
        name: entry.name,
        meta: {
          ...existing.meta,
          ...meta,
          tools: Array.from(new Set([...existing.meta.tools, ...meta.tools])),
        },
        systemPrompt: systemPrompt || existing.systemPrompt,
        isCustom: isCustom || existing.isCustom,
        sourceDir: dir,
        toolFiles: Array.from(new Set([...existing.toolFiles, ...toolFiles])),
      });
    } else {
      map.set(entry.name, {
        name: entry.name,
        meta,
        systemPrompt,
        isCustom,
        sourceDir: dir,
        toolFiles,
      });
    }
  }
}

function getCharWidth(cp: number): number {
  if (cp >= 0xfe00 && cp <= 0xfe0f) return 0; // variation selector
  if (
    (cp >= 0x1f300 && cp <= 0x1faff) || // Misc symbols, pictographs
    (cp >= 0x2600 && cp <= 0x27bf) ||   // Dingbats, misc symbols
    (cp >= 0x2b50 && cp <= 0x2b55) ||   // Stars
    (cp >= 0x4e00 && cp <= 0x9fff)      // CJK ideographs
  ) {
    return 2;
  }
  return 1;
}

export function strWidth(str: string): number {
  const clean = str.replace(/\u001b\[[0-9;]*m/g, "");
  let w = 0;
  for (const ch of clean) {
    w += getCharWidth(ch.codePointAt(0) || 0);
  }
  return w;
}

function wrapLine(line: string, maxWidth: number): string[] {
  if (strWidth(line) <= maxWidth) return [line];
  const words = line.split(" ");
  const wrapped: string[] = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? `${cur} ${word}` : word;
    if (strWidth(test) <= maxWidth) {
      cur = test;
    } else {
      if (cur) wrapped.push(cur);
      cur = word;
    }
  }
  if (cur) wrapped.push(cur);
  return wrapped;
}

export function formatBox(
  title: string,
  lines: string[],
  options: { minWidth?: number; maxWidth?: number } = {}
): string {
  const minW = options.minWidth || 56;
  const maxW = options.maxWidth || 78;

  const processedLines: string[] = [];
  for (const item of lines) {
    if (item === "---" || item === "") {
      processedLines.push(item);
    } else {
      const wrapped = wrapLine(item, maxW - 4);
      processedLines.push(...wrapped);
    }
  }

  let maxLen = title ? strWidth(title) + 4 : 0;
  for (const l of processedLines) {
    if (l !== "---") {
      const w = strWidth(l);
      if (w > maxLen) maxLen = w;
    }
  }

  const boxWidth = Math.min(maxW, Math.max(minW, maxLen + 4));
  const innerW = boxWidth - 4;

  const titleW = title ? strWidth(title) : 0;
  const rightDashes = title ? Math.max(0, boxWidth - titleW - 5) : boxWidth - 2;
  const topBorder = title ? `╭─ ${title} ${"─".repeat(rightDashes)}╮` : `╭${"─".repeat(boxWidth - 2)}╮`;
  const bottomBorder = `╰${"─".repeat(boxWidth - 2)}╯`;
  const divider = `├${"─".repeat(boxWidth - 2)}┤`;

  const output: string[] = [topBorder];
  for (const line of processedLines) {
    if (line === "---") {
      output.push(divider);
    } else if (line === "") {
      output.push(`│ ${" ".repeat(innerW)} │`);
    } else {
      const w = strWidth(line);
      const pad = " ".repeat(Math.max(0, innerW - w));
      output.push(`│ ${line}${pad} │`);
    }
  }
  output.push(bottomBorder);
  return output.join("\n");
}

export default async function piHarnessExtension(pi: ExtensionAPI) {
  let activeProfile: Profile | undefined = undefined;

  // 1. Discover all profiles and dynamically register profile-scoped tools
  const initialProfiles = loadAllProfiles(process.cwd());
  for (const profile of initialProfiles.values()) {
    for (const toolFilePath of profile.toolFiles) {
      try {
        const toolUrl = pathToFileURL(toolFilePath).href;
        const mod = await import(toolUrl);
        const candidate = mod.default || mod[Object.keys(mod)[0]];

        if (candidate && typeof candidate === "object" && candidate.name && typeof candidate.execute === "function") {
          pi.registerTool(candidate);
          if (!profile.meta.tools.includes(candidate.name)) {
            profile.meta.tools.push(candidate.name);
          }
        } else if (typeof candidate === "function") {
          await candidate(pi);
        }
      } catch (err: any) {
        console.error(`[pi_harness] Failed to load tool from ${toolFilePath}:`, err);
      }
    }
  }

  const HARNESS_TOOLS = ["create_profile", "switch_profile"];

  // 2. Register CLI flag: pi --profile <name>
  pi.registerFlag("profile", {
    description: "Active profile persona to load at startup (e.g. coder, writer, researcher)",
    type: "string",
  });

  function updateStatus(ctx?: ExtensionContext | ExtensionCommandContext) {
    if (!ctx?.ui?.setStatus) return;
    if (activeProfile) {
      const label = `[profile:${activeProfile.name}]`;
      ctx.ui.setStatus("profile", ctx.ui.theme ? ctx.ui.theme.fg("accent", label) : label);
    } else {
      ctx.ui.setStatus("profile", undefined);
    }
  }

  function applyProfile(profile: Profile, ctx?: ExtensionContext | ExtensionCommandContext) {
    activeProfile = profile;

    // Apply thinking level
    if (profile.meta.defaultThinkingLevel) {
      try {
        pi.setThinkingLevel(profile.meta.defaultThinkingLevel);
      } catch {
        // ignore
      }
    }

    // Apply tool whitelist (always keeping harness tools active)
    if (profile.meta.tools && profile.meta.tools.length > 0) {
      try {
        const allToolNames = pi.getAllTools().map((t) => t.name);
        const validTools = Array.from(
          new Set([
            ...profile.meta.tools.filter((t) => allToolNames.includes(t)),
            ...HARNESS_TOOLS.filter((t) => allToolNames.includes(t)),
          ])
        );
        if (validTools.length > 0) {
          pi.setActiveTools(validTools);
        }
      } catch {
        // ignore
      }
    }

    try {
      updateStatus(ctx);
    } catch {
      // ignore
    }
  }

  function switchProfile(
    profileName: string,
    ctx?: ExtensionContext | ExtensionCommandContext
  ): { success: boolean; message: string; profile?: Profile } {
    const cwd = ctx && "cwd" in ctx && ctx.cwd ? ctx.cwd : process.cwd();
    const allProfiles = loadAllProfiles(cwd);
    const target = allProfiles.get(profileName.toLowerCase().trim());
    if (!target) {
      const available = Array.from(allProfiles.keys()).join(", ");
      return {
        success: false,
        message: `Profile "${profileName}" not found. Available profiles: ${available || "none"}`,
      };
    }

    applyProfile(target, ctx);
    try {
      pi.appendEntry("profile-state", { name: target.name });
    } catch {
      // ignore
    }

    const msg =
      `Switched active profile to "${target.meta.displayName || target.name}" (${target.name}).\n` +
      `Tools: ${target.meta.tools.join(", ")}\n` +
      `Thinking: ${target.meta.defaultThinkingLevel || "default"}\n` +
      `Note: Changing system prompts mid-session resets the KV cache prefix for subsequent turns.`;

    return {
      success: true,
      message: msg,
      profile: target,
    };
  }

  // 3. Register Tool: create_profile
  const CreateProfileParams = {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "Unique slug identifier for the profile (alphanumeric, hyphens, underscores, e.g. 'writer', 'code-reviewer')",
      },
      displayName: {
        type: "string",
        description: "Human-friendly display name (e.g. 'Technical Writer & Doc Architect')",
      },
      description: {
        type: "string",
        description: "Brief summary of the persona, its focus, and recommended use cases",
      },
      systemPrompt: {
        type: "string",
        description: "Primary system prompt markdown defining role, persona identity, instructions, and objectives",
      },
      rules: {
        type: "array",
        items: { type: "string" },
        description: "Optional list of modular rule directives to organize under rules/ or append to the prompt",
      },
      tools: {
        type: "array",
        items: { type: "string" },
        description:
          "Allowed tool names whitelist (e.g. ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']). Defaults to standard tools.",
      },
      defaultThinkingLevel: {
        type: "string",
        enum: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
        description: "Default thinking level for this persona",
      },
      scope: {
        type: "string",
        enum: ["global", "project"],
        description:
          "Where to store the profile: 'global' (~/.pi/agent/profiles/) or 'project' (<cwd>/.pi/profiles/). Default: 'global'",
      },
      switchTo: {
        type: "boolean",
        description: "Whether to immediately switch active profile to this new profile (default: true)",
      },
    },
    required: ["name", "description", "systemPrompt"],
  } as const;

  const createProfileTool = {
    name: "create_profile",
    label: "Create New Profile",
    description:
      "Create a new Pi Agent profile persona with custom system prompt, modular rules, tool whitelist, and thinking level.",
    parameters: CreateProfileParams,
    async execute(
      _toolCallId: string,
      params: {
        name: string;
        displayName?: string;
        description: string;
        systemPrompt: string;
        rules?: string[];
        tools?: string[];
        defaultThinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
        scope?: "global" | "project";
        switchTo?: boolean;
      },
      _signal: any,
      _onUpdate: any,
      ctx: ExtensionContext
    ) {
      const slug = params.name.trim().toLowerCase();
      if (!/^[a-z0-9_-]+$/.test(slug)) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Profile name "${params.name}" is invalid. Must only contain alphanumeric characters, hyphens, and underscores.`,
            },
          ],
          isError: true,
        };
      }

      const scope = params.scope || "global";
      let targetBaseDir: string;
      if (scope === "project") {
        targetBaseDir = path.join(ctx.cwd, CONFIG_DIR_NAME, "profiles");
      } else {
        targetBaseDir = path.join(getAgentDir(), "profiles");
      }

      const profileDir = path.join(targetBaseDir, slug);
      try {
        fs.mkdirSync(profileDir, { recursive: true });

        const allowedTools =
          Array.isArray(params.tools) && params.tools.length > 0
            ? params.tools
            : ["read", "bash", "edit", "write", "grep", "find", "ls"];

        const profileMeta: ProfileMeta = {
          name: slug,
          displayName: params.displayName?.trim() || slug.toUpperCase(),
          description: params.description.trim(),
          tools: allowedTools,
        };
        if (params.defaultThinkingLevel) {
          profileMeta.defaultThinkingLevel = params.defaultThinkingLevel;
        }
        fs.writeFileSync(path.join(profileDir, "profile.json"), JSON.stringify(profileMeta, null, 2) + "\n");

        fs.writeFileSync(path.join(profileDir, "system.md"), params.systemPrompt.trim() + "\n");

        if (Array.isArray(params.rules) && params.rules.length > 0) {
          const rulesDir = path.join(profileDir, "rules");
          fs.mkdirSync(rulesDir, { recursive: true });
          const rulesMarkdown = params.rules.map((r, i) => `${i + 1}. ${r.trim()}`).join("\n");
          fs.writeFileSync(path.join(rulesDir, "01-rules.md"), `# Rules & Directives\n\n${rulesMarkdown}\n`);
        }

        const toolsConfig = {
          profile: slug,
          allowedTools: allowedTools,
        };
        fs.writeFileSync(path.join(profileDir, "tools.json"), JSON.stringify(toolsConfig, null, 2) + "\n");

        const allProfiles = loadAllProfiles(ctx.cwd);
        const created = allProfiles.get(slug);

        let switchMsg = "";
        const shouldSwitch = params.switchTo !== false;
        if (shouldSwitch && created) {
          const switchRes = switchProfile(slug, ctx);
          switchMsg = `\n\n${switchRes.message}`;
        }

        const output = `Successfully created profile "${slug}" at ${profileDir}.${switchMsg}`;
        if (ctx.ui?.notify) {
          ctx.ui.notify(`Profile "${slug}" created successfully!`, "info");
        }

        return {
          content: [{ type: "text", text: output }],
          details: { profilePath: profileDir, profile: created?.meta || profileMeta, switched: shouldSwitch },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Failed to create profile: ${err.message}` }],
          isError: true,
        };
      }
    },
  };

  // 4. Register Tool: switch_profile
  const SwitchProfileParams = {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The name of the profile to switch to (e.g. 'coder', 'writer', 'researcher')",
      },
    },
    required: ["name"],
  } as const;

  const switchProfileTool = {
    name: "switch_profile",
    label: "Switch Active Profile",
    description:
      "Dynamically switch the active profile persona, system prompt, tool whitelist, and thinking level for subsequent turns.",
    parameters: SwitchProfileParams,
    async execute(
      _toolCallId: string,
      params: { name: string },
      _signal: any,
      _onUpdate: any,
      ctx: ExtensionContext
    ) {
      const res = switchProfile(params.name, ctx);
      if (!res.success) {
        return {
          content: [{ type: "text", text: `Error: ${res.message}` }],
          isError: true,
        };
      }

      if (ctx.ui?.notify) {
        ctx.ui.notify(`Profile switched to "${res.profile?.meta.displayName || res.profile?.name}"`, "info");
      }

      return {
        content: [{ type: "text", text: res.message }],
        details: { profile: res.profile?.meta },
      };
    },
  };

  pi.registerTool(createProfileTool);
  pi.registerTool(switchProfileTool);

  // 5. Command: /profiles - List all profiles
  pi.registerCommand("profiles", {
    description: "List all prebuilt and custom Pi Agent profiles",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const allProfiles = loadAllProfiles(ctx.cwd);
      if (allProfiles.size === 0) {
        ctx.ui.notify(formatBox("Pi Agent Profiles", ["No profiles found."]), "warning");
        return;
      }

      const prebuiltList: string[] = [];
      const customList: string[] = [];

      for (const p of allProfiles.values()) {
        const isCurrent = activeProfile?.name === p.name;
        const bullet = isCurrent ? "⭐ (active) " : "   ";
        const item = `• ${bullet}${p.meta.displayName || p.name} (${p.name})\n     ${p.meta.description}\n     Tools: ${p.meta.tools.join(", ")}`;
        if (p.isCustom) {
          customList.push(item);
        } else {
          prebuiltList.push(item);
        }
      }

      const lines: string[] = [
        `Active Profile for this session: "${activeProfile?.name || "default"}"`,
        "---",
        "📦 Prebuilt Profiles:",
      ];
      if (prebuiltList.length > 0) {
        for (const item of prebuiltList) {
          lines.push(...item.split("\n"));
        }
      } else {
        lines.push("  (none)");
      }

      lines.push("", "🛠️ Custom Profiles:");
      if (customList.length > 0) {
        for (const item of customList) {
          lines.push(...item.split("\n"));
        }
      } else {
        lines.push("  (none - add to ~/.pi/agent/profiles/)");
      }

      lines.push(
        "---",
        "💡 Switch: /switch <name> or /profile <name>",
        "💡 Create: use create_profile tool or place files in ~/.pi/agent/profiles/<name>/"
      );

      const msg = formatBox("Pi Agent Profiles", lines);
      ctx.ui.notify(msg, "info");
    },
  });

  // 6. Command: /profile - View active profile info or switch
  pi.registerCommand("profile", {
    description: "Show current session profile details, or switch profile: /profile <name>",
    getArgumentCompletions: (argumentPrefix: string) => {
      const allProfiles = loadAllProfiles(process.cwd());
      const names = Array.from(allProfiles.keys());
      return names
        .filter((n) => n.startsWith(argumentPrefix.toLowerCase()))
        .map((n) => ({ value: n, label: n }));
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const trimmed = args.trim();
      if (!trimmed) {
        if (!activeProfile) {
          ctx.ui.notify(
            formatBox("Active Profile", [
              "Running in default mode (no profile active).",
              "---",
              "💡 Switch to a profile via /switch <name> or /profile <name>",
            ]),
            "info"
          );
          return;
        }

        const lines = [
          `Name         : ${activeProfile.name}`,
          `Display Name : ${activeProfile.meta.displayName}`,
          `Type         : ${activeProfile.isCustom ? "Custom" : "Prebuilt"}`,
          `Thinking     : ${activeProfile.meta.defaultThinkingLevel || "default"}`,
          `Tools        : ${activeProfile.meta.tools.join(", ")}`,
          `Description  : ${activeProfile.meta.description}`,
          "---",
          "💡 Dynamic switching is active.",
          "   Switch anytime via: /switch <name> or /profile <name>",
        ];

        ctx.ui.notify(formatBox(`Profile: ${activeProfile.name}`, lines), "info");
        return;
      }

      let targetName = trimmed;
      if (targetName.startsWith("switch ")) {
        targetName = targetName.slice(7).trim();
      }

      const res = switchProfile(targetName, ctx);
      if (res.success && res.profile) {
        const lines = [
          `Switched active profile to:`,
          `  ${res.profile.meta.displayName || res.profile.name} (${res.profile.name})`,
          "",
          `Tools    : ${res.profile.meta.tools.join(", ")}`,
          `Thinking : ${res.profile.meta.defaultThinkingLevel || "default"}`,
          "---",
          "⚠️  Note: Mid-session prompt changes reset the prefix",
          "   KV cache for subsequent turns.",
        ];
        ctx.ui.notify(formatBox("Profile Switched", lines), "info");
      } else {
        const allProfiles = loadAllProfiles(ctx.cwd);
        const names = Array.from(allProfiles.keys()).join(", ");
        const lines = [
          `Profile "${targetName}" not found.`,
          `Available profiles: ${names || "none"}`,
        ];
        ctx.ui.notify(formatBox("Profile Switch Error", lines), "warning");
      }
    },
  });

  // 7. Command: /switch - Shortcut to dynamically switch profile
  pi.registerCommand("switch", {
    description: "Dynamically switch the active profile persona and toolset",
    getArgumentCompletions: (argumentPrefix: string) => {
      const allProfiles = loadAllProfiles(process.cwd());
      const names = Array.from(allProfiles.keys());
      return names
        .filter((n) => n.startsWith(argumentPrefix.toLowerCase()))
        .map((n) => ({ value: n, label: n }));
    },
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const targetName = args.trim();
      if (!targetName) {
        const allProfiles = loadAllProfiles(ctx.cwd);
        const names = Array.from(allProfiles.keys()).join(", ");
        const lines = [
          "Usage: /switch <profile-name>",
          `Available profiles: ${names || "none"}`,
        ];
        ctx.ui.notify(formatBox("Switch Profile", lines), "warning");
        return;
      }
      const res = switchProfile(targetName, ctx);
      if (res.success && res.profile) {
        const lines = [
          `Switched active profile to:`,
          `  ${res.profile.meta.displayName || res.profile.name} (${res.profile.name})`,
          "",
          `Tools    : ${res.profile.meta.tools.join(", ")}`,
          `Thinking : ${res.profile.meta.defaultThinkingLevel || "default"}`,
          "---",
          "⚠️  Note: Mid-session prompt changes reset the prefix",
          "   KV cache for subsequent turns.",
        ];
        ctx.ui.notify(formatBox("Profile Switched", lines), "info");
      } else {
        const allProfiles = loadAllProfiles(ctx.cwd);
        const names = Array.from(allProfiles.keys()).join(", ");
        const lines = [
          `Profile "${targetName}" not found.`,
          `Available profiles: ${names || "none"}`,
        ];
        ctx.ui.notify(formatBox("Profile Switch Error", lines), "warning");
      }
    },
  });

  // 8. Inject active profile system prompt dynamically on each agent turn
  pi.on("before_agent_start", async (event) => {
    if (activeProfile?.systemPrompt) {
      return {
        systemPrompt: `${event.systemPrompt}\n\n## Profile: ${activeProfile.meta.displayName || activeProfile.name}\n${activeProfile.systemPrompt}`,
      };
    }
  });

  // 9. Initialize Profile at Session Startup
  pi.on("session_start", async (_event, ctx) => {
    const allProfiles = loadAllProfiles(ctx.cwd);

    // Check CLI flag
    const flagVal = pi.getFlag("profile");
    let chosenProfileName: string | undefined = undefined;

    if (typeof flagVal === "string" && flagVal) {
      chosenProfileName = flagVal.toLowerCase();
    } else {
      // Check if restored session has a saved profile state
      const entries = ctx.sessionManager.getEntries();
      const savedEntry = entries
        .filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "profile-state")
        .pop() as { data?: { name: string } } | undefined;

      if (savedEntry?.data?.name) {
        chosenProfileName = savedEntry.data.name;
      } else {
        // Default to "coder" profile if available
        if (allProfiles.has("coder")) {
          chosenProfileName = "coder";
        }
      }
    }

    if (chosenProfileName && allProfiles.has(chosenProfileName)) {
      const selected = allProfiles.get(chosenProfileName)!;
      applyProfile(selected, ctx);
    } else if (chosenProfileName) {
      ctx.ui.notify(`Requested profile "${chosenProfileName}" not found. Falling back to default.`, "warning");
    }

    updateStatus(ctx);
  });

  // 10. Persist profile state on turn start
  pi.on("turn_start", async () => {
    if (activeProfile) {
      pi.appendEntry("profile-state", { name: activeProfile.name });
    }
  });
}
