import {
  DefaultResourceLoader,
  getAgentDir,
} from "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");

async function runVerify() {
  console.log("==================================================");
  console.log("🧪 Testing pi-profile-harness Extension Package");
  console.log("==================================================");

  const loader = new DefaultResourceLoader({
    cwd: packageRoot,
    agentDir: getAgentDir(),
    additionalExtensionPaths: [path.join(packageRoot, "index.ts")],
  });

  await loader.reload();
  const extResult = loader.getExtensions();
  const harnessExt = extResult.extensions.find((e) => e.path.includes(packageRoot));

  if (!harnessExt) {
    throw new Error("pi-profile-harness extension failed to load!");
  }
  console.log("   ✓ pi-profile-harness extension loaded successfully.");

  // Test slash commands
  const profilesCmd = harnessExt.commands.get("profiles");
  const profileCmd = harnessExt.commands.get("profile");

  if (!profilesCmd || !profileCmd) {
    throw new Error("Missing /profiles or /profile slash commands in pi-profile-harness!");
  }

  let notified = "";
  const mockCtx = {
    cwd: packageRoot,
    ui: {
      notify: (msg) => {
        notified = msg;
      },
    },
  };

  await profilesCmd.handler("", mockCtx);
  if (!notified.includes("Prebuilt Profiles") || !notified.includes("coder") || !notified.includes("╭─") || !notified.includes("╰─")) {
    throw new Error("/profiles command output was not properly wrapped in box borders!");
  }
  console.log("   ✓ /profiles command executed successfully with boxed output.");

  await profileCmd.handler("", mockCtx);
  if (!notified.includes("Active Profile") || !notified.includes("╭─") || !notified.includes("╰─")) {
    throw new Error("/profile command output was not properly wrapped in box borders!");
  }
  console.log("   ✓ /profile command executed successfully with boxed output.");

  // Test /switch command
  const switchCmd = harnessExt.commands.get("switch");
  if (!switchCmd) {
    throw new Error("Missing /switch slash command in pi-profile-harness!");
  }
  console.log("   ✓ /switch command registered successfully.");

  // Test command completions
  const switchCompletions = await switchCmd.getArgumentCompletions?.("co");
  if (!switchCompletions?.some((c) => c.value === "coder")) {
    throw new Error("/switch argument autocompletion failed to suggest 'coder'!");
  }
  console.log("   ✓ /switch argument autocompletion works.");

  // Test dynamic tool registration: git_status, create_profile, switch_profile
  const gitStatusTool = harnessExt.tools.get("git_status");
  if (!gitStatusTool) {
    throw new Error("Profile tool 'git_status' was not dynamically registered!");
  }
  console.log("   ✓ Profile tool 'git_status' registered dynamically:", gitStatusTool.definition.description);

  const createProfileTool = harnessExt.tools.get("create_profile");
  if (!createProfileTool) {
    throw new Error("Harness tool 'create_profile' was not registered!");
  }
  console.log("   ✓ Harness tool 'create_profile' registered:", createProfileTool.definition.description);

  const switchProfileTool = harnessExt.tools.get("switch_profile");
  if (!switchProfileTool) {
    throw new Error("Harness tool 'switch_profile' was not registered!");
  }
  console.log("   ✓ Harness tool 'switch_profile' registered:", switchProfileTool.definition.description);

  // Test creating a new profile dynamically via create_profile tool
  const testProfileName = "test_persona";
  const testProjectProfileDir = path.join(packageRoot, ".pi", "profiles", testProfileName);

  try {
    const createResult = await createProfileTool.definition.execute(
      "call_create_1",
      {
        name: testProfileName,
        displayName: "Automated Test Persona",
        description: "A test persona created by test suite",
        systemPrompt: "You are an automated verification persona.",
        rules: [
          "Rule 1: Always verify assertions",
          "Rule 2: Keep tests idempotent",
        ],
        tools: ["read", "bash", "edit"],
        defaultThinkingLevel: "low",
        scope: "project",
        switchTo: true,
      },
      undefined,
      undefined,
      mockCtx
    );

    if (createResult.isError) {
      throw new Error(`create_profile tool failed: ${JSON.stringify(createResult)}`);
    }
    console.log("   ✓ create_profile executed successfully.");

    // Verify files on disk
    if (!fs.existsSync(path.join(testProjectProfileDir, "profile.json"))) {
      throw new Error("profile.json was not created!");
    }
    if (!fs.existsSync(path.join(testProjectProfileDir, "system.md"))) {
      throw new Error("system.md was not created!");
    }
    if (!fs.existsSync(path.join(testProjectProfileDir, "rules", "01-rules.md"))) {
      throw new Error("rules/01-rules.md was not created!");
    }
    if (!fs.existsSync(path.join(testProjectProfileDir, "tools.json"))) {
      throw new Error("tools.json was not created!");
    }
    console.log("   ✓ Profile files created on disk with modular rules.");

    // Test switching profiles via switch_profile tool
    const switchResult = await switchProfileTool.definition.execute(
      "call_switch_1",
      { name: "coder" },
      undefined,
      undefined,
      mockCtx
    );
    if (switchResult.isError) {
      throw new Error(`switch_profile tool failed: ${JSON.stringify(switchResult)}`);
    }
    console.log("   ✓ switch_profile tool executed successfully.");

    // Test switching via /switch slash command
    await switchCmd.handler(testProfileName, mockCtx);
    if (!notified.includes(testProfileName) || !notified.includes("╭─") || !notified.includes("╰─")) {
      throw new Error(`/switch command output was not properly wrapped in box borders!`);
    }
    console.log("   ✓ /switch slash command switched profile successfully with boxed output.");
  } finally {
    // Clean up temporary test profile
    if (fs.existsSync(testProjectProfileDir)) {
      fs.rmSync(testProjectProfileDir, { recursive: true, force: true });
    }
    const dotPiProfilesDir = path.join(packageRoot, ".pi", "profiles");
    if (fs.existsSync(dotPiProfilesDir) && fs.readdirSync(dotPiProfilesDir).length === 0) {
      fs.rmdirSync(dotPiProfilesDir);
    }
    const dotPiDir = path.join(packageRoot, ".pi");
    if (fs.existsSync(dotPiDir) && fs.readdirSync(dotPiDir).length === 0) {
      fs.rmdirSync(dotPiDir);
    }
  }

  console.log("==================================================");
  console.log("✅ pi-profile-harness verification passed!");
  console.log("==================================================");
}

runVerify().catch((err) => {
  console.error("❌ Verification failed:", err);
  process.exit(1);
});
