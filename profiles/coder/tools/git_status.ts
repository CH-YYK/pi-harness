/**
 * Profile-Exclusive Tool for Coder Persona: git_status
 *
 * Provides structured git repository status and recent commit context.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const GitStatusParams = {
  type: "object",
  properties: {
    includeRecentCommits: {
      type: "boolean",
      description: "Include last 5 git commits in output (default: true)",
    },
  },
} as const;

export const gitStatusTool = {
  name: "git_status",
  label: "Git Repository Status",
  description: "Get structured status of the working git tree and recent commits.",
  parameters: GitStatusParams,
  async execute(_toolCallId: string, params: { includeRecentCommits?: boolean }, _signal: any, _onUpdate: any, ctx: any) {
    const cwd = ctx.cwd;
    const includeCommits = params.includeRecentCommits !== false;

    try {
      const { stdout: statusOut } = await execFileAsync("git", ["status", "--short", "--branch"], { cwd });
      let output = `Git Branch & Working Tree Status:\n${statusOut.trim() || "(clean working tree)"}\n`;

      if (includeCommits) {
        const { stdout: logOut } = await execFileAsync("git", ["log", "-n", "5", "--oneline"], { cwd });
        output += `\nRecent Commits:\n${logOut.trim() || "(no commits)"}\n`;
      }

      return {
        content: [{ type: "text", text: output }],
        details: { status: statusOut.trim() },
      };
    } catch (err: any) {
      return {
        content: [{ type: "text", text: `Git status error: ${err.message}` }],
        details: {},
        isError: true,
      };
    }
  },
};

export default gitStatusTool;
