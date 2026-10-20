
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Plant67OpenCodePlugin } from "../adapters/opencode/plant-67";

const scratch = mkdtempSync(join(homedir(), ".plant-opencode-test-"));
const plant = join(scratch, ".plant-67");
mkdirSync(plant, { mode: 0o700 });

after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function readAgent() {
  const agents = join(plant, "agents");
  const files = readdirSync(agents).filter((name) => name.endsWith(".json"));
  assert.equal(files.length, 1);
  return JSON.parse(readFileSync(join(agents, files[0]), "utf8"));
}

test("tool events write a running agent with a stable project key", async () => {
  const hooks = await Plant67OpenCodePlugin({
    directory: "/work/example",
    env: { PLANT67_DIR: plant },
  });

  await hooks["tool.execute.before"]({ sessionID: "session-1" }, {});
  const first = readAgent();

  assert.equal(first.v, 1);
  assert.equal(first.key, "opencode:/work/example");
  assert.equal(first.name, "example");
  assert.equal(first.harness, "OpenCode");
  assert.equal(first.status, "running");
  assert.equal(first.hears, false);
  assert.ok(first.heartbeatAt);

  await hooks["tool.execute.after"]({ sessionID: "session-1" }, {});
  const second = readAgent();
  assert.equal(second.key, first.key);
  assert.equal(second.status, "running");
});

test("session.idle changes the agent to idle", async () => {
  const hooks = await Plant67OpenCodePlugin({
    directory: "/work/example",
    env: { PLANT67_DIR: plant },
  });

  await hooks["tool.execute.before"]({ sessionID: "session-1" }, {});
  await hooks.event({
    event: {
      type: "session.idle",
      properties: { sessionID: "session-1" },
    },
  });

  const agent = readAgent();
  assert.equal(agent.status, "idle");
  assert.equal(agent.heartbeatAt, null);
});

test("does not create a missing plant root", async () => {
  const missing = join(scratch, "not-created");
  const hooks = await Plant67OpenCodePlugin({
    directory: "/work/example",
    env: { PLANT67_DIR: missing },
  });

  await hooks["tool.execute.before"]({ sessionID: "session-1" }, {});
  assert.equal(readdirSync(scratch).includes("not-created"), false);
});
