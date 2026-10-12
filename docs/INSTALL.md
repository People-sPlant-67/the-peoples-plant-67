# Install

Three ways in. Pick the one that matches where your agents live.

- [Just look: the demo](#just-look-the-demo)
- [Claude Code or Codex: the bridge](#claude-code-or-codex-the-bridge)
- [Paperclip: the Chrome extension](#paperclip-the-chrome-extension)

Something went wrong? [TROUBLESHOOTING.md](TROUBLESHOOTING.md) has every message the plant prints, with what to do.

## Just look: the demo

A made-up plant that changes every few seconds, with the founding form, directives, tribunals and hires all working against a built-in mock. Nothing to install: open [people-splant-67.github.io](https://people-splant-67.github.io/).

To run it on your own computer, you need Node 20.19 or newer and a clone of this repository:

```bash
npm ci
npm run demo
python3 -m http.server 8067 --directory dist-demo
```

Then open `http://localhost:8067`. Any static web server works in place of the last line.

## Claude Code or Codex: the bridge

No Paperclip needed. You need Node 20.19 or newer (on Node 22, 22.12 or newer), on macOS or Linux. On Windows, use WSL, on a computer nobody else uses (see [SECURITY.md](../SECURITY.md)).

### 1. Start the plant

```bash
npx github:People-sPlant-67/the-peoples-plant-67
```

The first run downloads and builds the plant, which takes under a minute. This command is the **bridge**: it serves the plant and keeps track of your agents. It opens the plant in your browser at an address of its own on this computer, and prints the link.

Leave that terminal open. Ctrl+C in it stops the plant.

The link carries the plant's key, so only you can reach your agents through it. Keep it to yourself, and paste it only into the address bar. The key and the address change each time the plant starts, and the plant opens a fresh tab when it does. Your choices (the founding form, the layout, the sound) are kept in the plant's folder, so they stay.

### 2. Wire your harness

In a second terminal, for Claude Code:

```bash
npx github:People-sPlant-67/the-peoples-plant-67 hooks claude
```

For Codex:

```bash
npx github:People-sPlant-67/the-peoples-plant-67 hooks codex
```

Then open Codex, type `/hooks`, and trust the plant's hooks. Codex asks once.

The command adds the plant's hooks to your harness's settings and keeps a backup of the file. Your other hooks are untouched. For an older Codex without hooks, add `--notify` to use its notify program instead.

### 3. Start a session

Start a new session in a project folder. Each project folder you work in becomes a comrade, and walks into the plant.

Click a comrade to send a directive of up to 7,000 characters. Your agent reads it with the next prompt you type in its terminal, and its answer comes back in the plant. A comrade waiting for your OK in the terminal stays at its station with a red flag.

### Later

- **Unwire a harness.** Add `--remove` to its hooks command: `npx github:People-sPlant-67/the-peoples-plant-67 hooks claude --remove`.
- **Upgraded Node?** Run the hooks command again. The plant says so when it starts, if the hooks' Node has gone.
- **Another port.** Add `--port 6768` to the start command.
- **Another folder.** Everything stays on your computer, in `~/.plant-67`. To use another folder, add `--dir` and the folder's full path to the start command *and* to the hooks commands. It must be yours alone, outside every project.
- **Stay on one version.** The commands above run the newest version. Add a release's tag to stay on it, for example `npx github:People-sPlant-67/the-peoples-plant-67#v1.0.0`.
- **Ubuntu.** A browser installed as a snap may not open the plant by itself. Open the link the plant prints.
- `--help` lists every option.

To wire a harness other than Claude Code and Codex, see [ADAPTERS.md](ADAPTERS.md).

## Paperclip: the Chrome extension

The plant runs inside your Paperclip tab and uses the sign-in you already have there.

1. Download the zip from the [latest release](https://github.com/People-sPlant-67/the-peoples-plant-67/releases/latest), and unzip it into a folder that will stay put, such as `Documents/peoples-plant`. (Or build it yourself from a clone: `npm ci`, then `npm run ext` makes the folder `dist-extension`.)
2. Open `chrome://extensions`, switch on **Developer mode**, press **Load unpacked** and pick that folder.
3. A page opens. Type the address you open Paperclip at, such as `localhost:3100`, and press **Connect**. If you open Paperclip with `http://`, type `http://` in front of the address.
4. Chrome asks to let the plant "read and change your data" on that one site. That is how it draws inside your Paperclip tab. Choose **Allow**.
5. Press **Open the plant**.
6. Pin the plant from the Extensions button (the puzzle piece) in Chrome's toolbar. Its ★ then opens the plant from anywhere.

The plant stores the address and nothing else. To change the address later, right-click the ★ and choose **Options**.

**To update**, put the new files into the same folder, replacing the old ones. Then press the reload arrow on the plant's card in `chrome://extensions`. Loading a different folder makes Chrome treat it as a new extension, and you would have to connect again.

### Found the Ministry

The founding form opens by itself the first time. Its last pages give you an order to paste to your CEO agent. The order hires a Director of Operational Hygiene and sets up a daily hygiene routine, a Strike Ledger, the Lessons, and the tribunal threshold for the regime you pick. The plant then inspects your Paperclip and stamps each piece as it finds it. [ONBOARDING.md](ONBOARDING.md) has the full order.
