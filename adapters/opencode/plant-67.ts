
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  renameSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { ownFolder, plantDir } from "../../src/bridge/files";

type Status = "running" | "idle";

interface AdapterOptions {
  directory: string;
  env?: NodeJS.ProcessEnv;
}

function writeStatus(options: AdapterOptions, status: Status): void {
  try {
    const dir = plantDir(undefined, options.env ?? process.env);

    if (!existsSync(dir) || !ownFolder(dir)) return;

    const agents = join(dir, "agents");
    if (!existsSync(agents)) {
      mkdirSync(agents, { mode: 0o700 });
    }

    const agentsInfo = lstatSync(agents);
    const uid = typeof process.getuid === "function" ? process.getuid() : null;
    if (
      agentsInfo.isSymbolicLink() ||
      !agentsInfo.isDirectory() ||
      (uid !== null && agentsInfo.uid !== uid) ||
      (agentsInfo.mode & 0o022)
    ) return;

    chmodSync(agents, 0o700);

    const project = resolve(options.directory);
    const key = `opencode:${project}`;
    const now = new Date().toISOString();
    const record = {
      v: 1,
      key,
      name: basename(project).slice(0, 60) || "OpenCode",
      harness: "OpenCode",
      status,
      reason: null,
      updatedAt: now,
      heartbeatAt: status === "running" ? now : null,
      hears: false,
    };

    const hash = createHash("sha256").update(key).digest("hex").slice(0, 32);
    const file = join(agents, `${hash}.json`);
    const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;

    try {
      writeFileSync(tmp, JSON.stringify(record), { mode: 0o600 });
      renameSync(tmp, file);
    } catch {
      rmSync(tmp, { force: true });
    }
  } catch {
    // Reporting must never interrupt an OpenCode session.
  }
}

/** Exported separately so tests can exercise fake events without OpenCode running. */
function createOpenCodeHooks(options: AdapterOptions) {
  const running = () => writeStatus(options, "running");
  const idle = () => writeStatus(options, "idle");

  return {
    "tool.execute.before": async (_input: { sessionID?: string }, _output: unknown) => {
      running();
    },

    "tool.execute.after": async (_input: { sessionID?: string }, _output: unknown) => {
      running();
    },

    event: async ({ event }: {
      event: { type: string; properties?: { sessionID?: string } };
    }) => {
      if (event.type === "session.idle") idle();
    },
  };
}

/** OpenCode loads this exported plugin function automatically. */
export const Plant67OpenCodePlugin = async (
  { directory, env }: { directory: string; env?: NodeJS.ProcessEnv },
) => createOpenCodeHooks({ directory, env });
