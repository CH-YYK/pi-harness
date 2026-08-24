import {
  DefaultResourceLoader,
  getAgentDir,
} from "/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");

async function runVerify() {
  console.log("==================================================");
  console.log("🧪 Testing pi-harness Extension Package");
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
    throw new Error("pi-harness extension failed to load!");
  }
  console.log("   ✓ pi-harness extension loaded successfully.");

  // Test slash commands
  const profilesCmd = harnessExt.commands.get("profiles");
  const profileCmd = harnessExt.commands.get("profile");

  if (!profilesCmd || !profileCmd) {
    throw new Error("Missing /profiles or /profile slash commands in pi-harness!");
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
  if (!notified.includes("Prebuilt Profiles") || !notified.includes("coder")) {
    throw new Error("/profiles command failed to list coder profile!");
  }
  console.log("   ✓ /profiles command executed successfully.");

  await profileCmd.handler("", mockCtx);
  console.log("   ✓ /profile command executed successfully.");

  // Test dynamic tool registration
  const gitStatusTool = harnessExt.tools.get("git_status");
  if (!gitStatusTool) {
    throw new Error("Profile tool 'git_status' was not dynamically registered!");
  }
  console.log("   ✓ Profile tool 'git_status' registered dynamically:", gitStatusTool.definition.description);

  console.log("==================================================");
  console.log("✅ pi-harness verification passed!");
  console.log("==================================================");
}

runVerify().catch((err) => {
  console.error("❌ Verification failed:", err);
  process.exit(1);
});
