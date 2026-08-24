/**
 * Pi Harness Extension (pi_harness)
 *
 * Self-contained profile management system:
 * 1. Bundled prebuilt profiles: `extensions/pi_harness/profiles/<profile_name>/`
 * 2. User custom profiles: `~/.pi/agent/profiles/`, `~/.pi/profiles/`, `<cwd>/.pi/profiles/`
 * 3. Profile-exclusive tools: `profiles/<profile_name>/tools/*.ts`
 *
 * Design Principles:
 * - Session-Locked Immutability: Profile is selected at startup (`pi --profile <name>`) and locked
 *   for the entire session to guarantee KV prefix cache preservation and toolset integrity.
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
        systemPrompt = fs.readFileSync(systemPromptPath, "utf-8");
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

  // 2. Register CLI flag: pi --profile <name>
  pi.registerFlag("profile", {
    description: "Active profile persona to load at startup (e.g. coder, writer, researcher)",
    type: "string",
  });

  function updateStatus(ctx: ExtensionContext) {
    if (!ctx.ui?.setStatus) return;
    if (activeProfile) {
      const label = `[profile:${activeProfile.name}]`;
      ctx.ui.setStatus("profile", ctx.ui.theme ? ctx.ui.theme.fg("accent", label) : label);
    } else {
      ctx.ui.setStatus("profile", undefined);
    }
  }

  function applyProfile(profile: Profile, ctx: ExtensionContext) {
    activeProfile = profile;

    // Apply thinking level
    if (profile.meta.defaultThinkingLevel) {
      try {
        pi.setThinkingLevel(profile.meta.defaultThinkingLevel);
      } catch {
        // ignore
      }
    }

    // Apply tool whitelist
    if (profile.meta.tools && profile.meta.tools.length > 0) {
      try {
        const allToolNames = pi.getAllTools().map((t) => t.name);
        const validTools = profile.meta.tools.filter((t) => allToolNames.includes(t));
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

  // 3. Command: /profiles - List all profiles
  pi.registerCommand("profiles", {
    description: "List all prebuilt and custom Pi Agent profiles",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const allProfiles = loadAllProfiles(ctx.cwd);
      if (allProfiles.size === 0) {
        ctx.ui.notify("No profiles found.", "warning");
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

      let msg = `Active Profile for this session: "${activeProfile?.name || "default"}"\n\n`;
      msg += `📦 Prebuilt Profiles:\n${prebuiltList.join("\n\n") || "  (none)"}\n\n`;
      msg += `🛠️ Custom Profiles:\n${customList.join("\n\n") || "  (none - add to ~/.pi/agent/profiles/)"}\n\n`;
      msg += `💡 To launch with another profile: restart session with \`pi --profile <name>\``;

      ctx.ui.notify(msg, "info");
    },
  });

  // 4. Command: /profile - View active profile info
  pi.registerCommand("profile", {
    description: "Show current session profile details",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (!activeProfile) {
        ctx.ui.notify("Running in default mode (no profile locked).", "info");
        return;
      }

      const msg = `Active Profile: ${activeProfile.meta.displayName} (${activeProfile.name})\n` +
        `Type: ${activeProfile.isCustom ? "Custom" : "Prebuilt"}\n` +
        `Description: ${activeProfile.meta.description}\n` +
        `Tools Whitelist: ${activeProfile.meta.tools.join(", ")}\n` +
        `Thinking Level: ${activeProfile.meta.defaultThinkingLevel || "default"}\n\n` +
        `Note: Profile is locked for this session to preserve prefix cache & conversation integrity.`;

      ctx.ui.notify(msg, "info");
    },
  });

  // 5. Invariant: Inject active profile system prompt from turn 1
  pi.on("before_agent_start", async (event) => {
    if (activeProfile?.systemPrompt) {
      return {
        systemPrompt: `${event.systemPrompt}\n\n## Profile: ${activeProfile.meta.displayName || activeProfile.name}\n${activeProfile.systemPrompt}`,
      };
    }
  });

  // 6. Initialize & Lock Profile at Session Startup
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

  // 7. Persist profile state on turn start
  pi.on("turn_start", async () => {
    if (activeProfile) {
      pi.appendEntry("profile-state", { name: activeProfile.name });
    }
  });
}
