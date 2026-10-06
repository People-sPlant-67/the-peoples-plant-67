# The People's Plant #67

Your AI agent org, drawn as a Soviet factory in pixel art - reminiscent of a certain hotel.

Work in progress. The full README lands before release.

```bash
npm ci
npm run demo      # build the demo into dist-demo/, serve it with any static server
npm run dev       # work on the plant; open /cockpit.html
npm run ext       # build the Chrome extension into dist-extension/
npm run bridge    # build the npx bridge into dist-bridge/, run it with node dist-bridge/cli.mjs
```

## Use it with your Paperclip

1. Build the extension with `npm run ext`, which makes the folder `dist-extension`. Or download the zip from Releases and unzip it into a folder that will stay put, such as `Documents/peoples-plant`.
2. Open `chrome://extensions`, switch on Developer mode, press Load unpacked and pick that folder.
3. A page opens. Type the address you open Paperclip at, such as `localhost:3100`, and press Connect. If you open Paperclip with `http://`, type `http://` in front of the address.
4. Chrome asks to let the plant "read and change your data" on that one site. That is how it draws inside your Paperclip tab. Choose Allow.
5. Press Open the plant.
6. Pin the plant from the Extensions button (the puzzle piece) in Chrome's toolbar. Its ★ then opens the plant from anywhere.

The plant stores the address and nothing else. It runs inside your Paperclip tab and uses the sign-in you already have there. To change the address later, right-click the ★ and choose Options.

To update, put the new files into the same folder, replacing the old ones. Then press the reload arrow on the plant's card in `chrome://extensions`. Loading a different folder makes Chrome treat it as a new extension, and you would have to connect again.

## Use it with Claude Code or Codex

No Paperclip needed. You need Node 20 or newer.

1. Start the plant. The first run builds it, which takes under a minute.

   ```bash
   npx github:People-sPlant-67/the-peoples-plant-67
   ```

   It opens at `http://127.0.0.1:6767`. Leave that terminal open.
2. In a second terminal, wire your harness to it. For Claude Code:

   ```bash
   npx github:People-sPlant-67/the-peoples-plant-67 hooks claude
   ```

   For Codex, use `hooks codex`, then open Codex, type `/hooks` and trust the plant's hooks.
3. Start a new session. Each project folder you work in becomes a comrade.

Click a comrade to send a directive. Your agent reads it with the next prompt you type in its terminal, and its answer comes back in the plant. A comrade waiting for your OK in the terminal stays at its station with a red flag.

Everything stays on your computer, in `~/.plant-67`. Whatever can write to that folder can put words in your agents' prompts, so it is yours alone: the plant refuses a folder other users can write to, or one inside a project. To unwire a harness, add `--remove` to the hooks command. Upgraded Node? Run the hooks command again. [docs/ADAPTERS.md](docs/ADAPTERS.md) explains how it works and how to add another harness.

The commands above run the newest version on GitHub. To stay on one release, add its tag: `npx github:People-sPlant-67/the-peoples-plant-67#v1.0.0`.
