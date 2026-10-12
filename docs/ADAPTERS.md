# Adapters: draw any harness in the plant

The plant draws agents. Paperclip speaks to it natively. Claude Code and Codex reach it through the **bridge**, a small local server started with `npx`. Any other harness can join the same way. All it takes is a script that writes one small JSON file per agent.

This page is for people who want to add a harness. If you only want to use the plant, the README has the steps.

## How the bridge works

```
your harness ──hook──▶ adapter script ──writes──▶ ~/.plant-67/agents/<name>.json
                                                          │
                                   bridge (npx) ◀──reads──┘ ──serves──▶ the plant, in your browser
                                        │
                     directive ──▶ ~/.plant-67/inbox/<agent>/ ──▶ adapter hands it to the agent
                     answer    ◀── ~/.plant-67/replies/       ◀── adapter writes it after the turn
```

- The bridge listens on this computer's own addresses only (`127.0.0.1` and `[::1]`, port 6767), and opens the plant at an address of its own, `http://p67-<random>.localhost:6767`. It answers the [Plant Protocol](PLANT-PROTOCOL.md) (tiers 1 and 2) from the files in `~/.plant-67`, and only to requests signed with the plant's key, which never travels itself. The address and the key are new each time the bridge starts, and kept in that folder's `bridge.lock` while it runs. The page's own choices (the founding form, the layout, the sound) are kept in `prefs.json` in that folder.
- Whatever can write to that folder can put words in an agent's prompt, with the owner's authority. So the folder is a trust boundary: the bridge refuses one that other users can write to or change from above (shared folders such as `/tmp` included), or one inside a project, and it reads plain files only (no links, no pipes). Any program running as the owner can still write it, as it can write the owner's other files. Run only adapters you trust.
- `agents/`, `inbox/`, `delivered/` and `replies/` are the adapter's side, described below. `sessions/` and `awaiting/` belong to the Claude Code and Codex hook script: leave them alone. The hook script itself always lives in `~/.plant-67/hooks/`, in the home folder, whatever folder the plant uses.
- One bridge serves a folder at a time. A second one on the same folder says where the first is running.
- An adapter never talks to the bridge. It writes files, and the bridge reads them. The bridge does not even need to be running.
- Every file is written whole: write to a temporary name in the same folder (with a random part, so two writers never share it), then rename it into place.
- Everything you make in the folder is for the owner alone: folders `0700`, files `0600`. The bridge refuses to start on a folder that holds anything the owner's group or other users can write to, whatever your umask.
- Use the folder's absolute path. Ignore a relative `$PLANT67_DIR`: it would point somewhere else in each project.
- Never make the plant's folder yourself. If it is missing, do nothing: a folder someone else made again in its place must not be used.
- Before you read the inbox, check the folder as the hook script does (`ownFolder` in [`src/bridge/files.ts`](../src/bridge/files.ts)): a real folder, not a link, owned by the owner, closed to everyone else, with no folder above it that others can change. What is in the inbox goes into the agent's prompt.
- The folder is `~/.plant-67` unless the bridge is started with `--dir`, or `$PLANT67_DIR` is set.

## The agent file (required)

One file per agent in `agents/`. Name it anything ending in `.json`. The bridge reads every file in the folder.

```json
{
  "v": 1,
  "key": "aider:/work/shop",
  "name": "shop",
  "harness": "Aider",
  "status": "running",
  "reason": null,
  "updatedAt": "2026-10-06T12:00:00.000Z",
  "heartbeatAt": "2026-10-06T12:00:00.000Z"
}
```

| Field | Meaning |
|---|---|
| `key` | Stable and unique per agent. The plant's id is made from it, so changing it makes a new comrade. Use `<harness>:<project folder>`. |
| `name` | The comrade's name. The project folder's name works well. Up to 60 characters. |
| `harness` | The comrade's title, such as "Aider". The title also picks the comrade's station: see [personas.ts](../src/live/personas.ts). |
| `status` | `running`, `idle`, `waiting`, `error` or `paused`. Anything else reads as `idle`. |
| `reason` | A sentence. Shown for `error` and `paused`. For `waiting`, say what the agent waits for: the plant shows it in the status line. |
| `updatedAt` | When you wrote the file (ISO 8601). |
| `heartbeatAt` | When the agent last did something, or `null`. A heartbeat in the last two minutes shows the comrade at work even when `status` is `idle`. |
| `hears` | Optional. `false` when your adapter only reports, and cannot hand the agent messages: the plant then refuses to send it any, and says why. Leave it out if you take the inbox (below). |

What each status does in the plant:

| Status | The comrade | Notes |
|---|---|---|
| `running` | Works at their station | Falls back to `idle` if the file is not updated for 10 minutes. |
| `waiting` | Stays at their station, red flag on the roster | For "waiting for the owner's OK". Falls back to `idle` after a day with no update. |
| `idle` | Goes to the canteen | |
| `error` | Sent to Siberia, shivering | Counted on the noticeboard. |
| `paused` | Sent to Siberia | |

An agent whose file is not updated for 7 days leaves the roster. Delete the file to remove it at once.

## Directives and answers (optional)

Write the agent file and you have a living plant. To let the owner send directives too:

1. **Take messages.** When the owner sends a prompt, look in `inbox/<agent>/`, where `<agent>` is the first 32 hex characters of the SHA-256 of your `key`. Each file is one message:

   ```json
   { "v": 1, "issueId": "…", "identifier": "PLT-3", "title": "Fix the tests", "text": "Fix the failing tests in src/.", "kind": "directive", "at": "…" }
   ```

   **Move** it to `delivered/<agent>/` with a rename first. If the rename fails, another session took it, so skip it. Then give the text to the agent as if the owner had typed it, and remember the `issueId`s you handed over. Hand over a sensible amount per turn and leave the rest for the next: the Claude Code adapter stops at 8,000 characters, because Claude Code keeps a hook's context under 10,000 (the bridge takes messages of up to 7,000). If anything fails after the move, move the files back and forget the `issueId`s: the bridge leaves a delivered file alone for its first five seconds so you can.
2. **Send the answer.** When the turn ends, write the agent's last message to `replies/<anything>.json`:

   ```json
   { "v": 1, "key": "aider:/work/shop", "issueIds": ["…"], "text": "Fixed. All 41 tests pass.", "at": "…" }
   ```

   The bridge files it in those threads, but only threads assigned to the agent with that `key`.

The bridge only hands over what the owner typed in the plant. Nothing else ever writes to an inbox.

## The Claude Code and Codex adapter

Both run the same script, [`src/bridge/hook.ts`](../src/bridge/hook.ts), built to `plant-hook.mjs`. `hooks claude` and `hooks codex` copy it to `~/.plant-67/hooks/` and add it to `~/.claude/settings.json` or `~/.codex/hooks.json` (or `$CLAUDE_CONFIG_DIR/settings.json` and `$CODEX_HOME/hooks.json`, when those are set).

| Hook event | Comrade | Also |
|---|---|---|
| `SessionStart` | idle (a new session only) | Hands nothing over. It also fires on a compaction or a resume, in the middle of work, and then changes nothing. |
| `UserPromptSubmit` | running, heartbeat | Hands over waiting messages. A turn that was interrupted before `Stop` is forgotten. |
| `PreToolUse` | running, heartbeat | Never takes the waiting flag away: the OK has not come yet. Runs in the background. |
| `PostToolUse` | running, heartbeat | The tool ran, so any OK was given. Runs in the background. Tool events write at most every 5 seconds. |
| `Notification` with `permission_prompt` (Claude Code) | waiting | The notification's message is the reason. |
| `Notification` with `idle_prompt` (Claude Code) | idle | |
| `PermissionRequest` (Codex) | waiting | "Asks to use <tool>." |
| `Stop` | idle | Sends `last_assistant_message` as the answer, if messages were handed over this turn. If another Stop hook kept the turn going (`stop_hook_active`), the later answer goes back too. |
| `Interrupt` (Codex) | idle | The turn was interrupted: nothing is sent. |
| `StopFailure` (Claude Code) | error | The reason names the `error_type`. |
| `SessionEnd` | that session forgotten | |
| Codex `notify`, `agent-turn-complete` | idle, heartbeat | The fallback for a Codex without hooks: at work for two minutes after each turn. It cannot hand over messages. |

One comrade is one project folder per harness. A session keeps the folder it started in, even after a `cd`: Claude Code names it in `CLAUDE_PROJECT_DIR`, and for others the first folder a session reports is kept in `sessions/`. Two sessions in one folder share the comrade, which shows the most pressing state of the two: waiting, then running, then error, then idle.

Events that start or end a turn run in step with the agent. Tool events and notifications run in the background, and one that lands after a later event never overwrites it. Each event changes only its own session in the record, read again just before writing, so two sessions in one folder never undo each other.

The script never gets in the agent's way. Whatever goes wrong, it prints nothing and exits 0 within 4 seconds.

Tested against Claude Code 2.1.284 (hooks, live) and Codex CLI 0.145.0 (`notify`, live; hooks, by their documented payloads).

## A skeleton adapter

About thirty lines of Node, for a harness that can run a command when an agent starts or finishes. Call it with the status and the project folder: `node plant-adapter.mjs running /path/to/project`.

```js
#!/usr/bin/env node
// plant-adapter.mjs: tell The People's Plant #67 what an agent is doing.
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';

const [status = 'idle', project = process.cwd()] = process.argv.slice(2);
const HARNESS = 'My Harness';
const asked = process.env.PLANT67_DIR;
const dir = asked && isAbsolute(asked) ? asked : join(homedir(), '.plant-67');
if (!existsSync(dir)) process.exit(0); // The plant makes its folder. Never make it here.
const key = `myharness:${project}`;
const now = new Date().toISOString();

const record = {
  v: 1, key, name: basename(project), harness: HARNESS,
  status, reason: null, updatedAt: now,
  heartbeatAt: status === 'running' ? now : null,
  hears: false, // This one only reports: it does not take the inbox.
};

const agents = join(dir, 'agents');
mkdirSync(agents, { mode: 0o700, recursive: true });
const file = join(agents, `${createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`);
const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
writeFileSync(tmp, JSON.stringify(record), { mode: 0o600 });
renameSync(tmp, file);
```

To try it, start the bridge (it makes the folder), run `node plant-adapter.mjs running ~/some/project`, and the comrade walks in within three seconds. Run it again with `idle`, and they head to the canteen.

## Testing an adapter

- Start a bridge on a folder of its own so your real plant stays clean. Make it inside your home folder (the plant refuses shared folders such as `/tmp`): `npx github:People-sPlant-67/the-peoples-plant-67 --dir "$(mktemp -d "$HOME/plant-test.XXXXXX")" --port 6799`. The banner shows the folder.
- Point your adapter at the same folder with `PLANT67_DIR=<that folder>`.
- Every request must be signed with the plant's key. From a clone of this repository, `node scripts/plant-api.mjs <that folder> GET /api/companies` does that for you and gives the company id; `node scripts/plant-api.mjs <that folder> GET /api/companies/<id>/agents` shows what the plant sees.
- The bridge's own tests show every case: [`tests/bridge-hook.test.ts`](../tests/bridge-hook.test.ts) and [`tests/bridge-protocol.test.ts`](../tests/bridge-protocol.test.ts). [`tests/bridge-start.test.ts`](../tests/bridge-start.test.ts) runs the skeleton above against a real plant.

## Good first adapters

Harnesses nobody has wired yet. Each makes a fine first contribution:

- **Gemini CLI.** It has hooks (an experimental feature you switch on in its settings), including `SessionStart`, `BeforeTool`, `AfterTool` and `SessionEnd`, with JSON on stdin like Claude Code's.
- **OpenCode.** Its plugins get events such as `tool.execute.before` and `session.idle`.
- **Aider.** Its `--notifications-command` runs a command whenever it finishes and waits for you.
- **Windows.** The bridge and the hook script are tested on macOS (live) and Linux (the test suite in CI). Windows is the next platform to win.

Open an issue saying which one you are taking, so two people do not build the same adapter.
