# Troubleshooting

This page has every sentence the plant prints in its terminal when something goes wrong, the main ones it shows on its page, and those of the extension's options page. Find the sentence the plant printed, then read why and what to do. Search this page for a few words of it (Ctrl+F or ⌘F). Words in angle brackets, such as `<port>`, stand for whatever the plant printed in their place.

The start command below is the short one, `npx github:People-sPlant-67/the-peoples-plant-67`. When the plant runs with `--dir` or `--port`, it prints its commands with them included. Use what it printed.

- [Starting the plant](#starting-the-plant)
- [The command line](#the-command-line)
- [The plant's folder](#the-plants-folder)
- [Wiring Claude Code or Codex](#wiring-claude-code-or-codex)
- [The plant's page](#the-plants-page)
- [Answers to a signed request](#answers-to-a-signed-request)
- [The extension's options page](#the-extensions-options-page)
- [No message, still a problem](#no-message-still-a-problem)

## Starting the plant

**"Something else is using port `<port>`. Start the plant on another port: `<command>`"**
Another program, one that is not a plant, listens on that port. Run the command the plant printed: it has already found a free port. The hooks find the plant by its folder, so they need no change.

**"Another plant is already on port `<port>`. Stop it with Ctrl+C in its terminal, or start this one on another port: `<command>`"**
A plant for a different folder runs on that port. Stop it in its own terminal, or run the printed command to start this one beside it.

**"Something on port `<port>` does not answer. If it is a plant you paused with Ctrl+Z, type fg in its terminal, then press Ctrl+C. Or start this one on another port: `<command>`"**
Something holds the port and stays silent. Most often it is a plant someone paused with Ctrl+Z (its terminal says "Stopped"). Wake it with `fg` in that terminal, then stop it with Ctrl+C. Or start this one on the printed port.

**"Looking for the plant on port `<port>`. It does not answer yet, so this takes a few seconds."**
All is well so far. The plant for this folder may be busy, so the new start waits up to about 20 seconds for it before saying more.

**"The plant for this folder is still running as process `<pid>` on port `<port>`, but it does not answer. It may be busy, or paused with Ctrl+Z. If you paused it, type fg in its terminal, then press Ctrl+C. If it stays stuck, stop it with: kill `<pid>`; kill -CONT `<pid>`"**
This folder's plant is there but silent. If you paused it, wake and stop it as the sentence says. If you cannot find its terminal, first check that process is the plant: `ps -p <pid> -o command=` should name `the-peoples-plant-67` or `cli.mjs`. Then run the two `kill` commands it printed: the second wakes a paused plant so the first can stop it. Never delete `bridge.lock` instead. A second plant on the same folder would overwrite the first one's threads.

**"★ The plant for this folder is already running. Open it at `<link>`"**
All is well. This folder's plant is running, so the new start points you at it and ends. Open that link.

**"The plant cannot use port `<port>`. Pick one from 1025 to 65535: `<command>`"**
This computer refused that port to the plant. Run the printed command, or choose another port with `--port`.

**"The plant's pages are missing from `<folder>`. Reinstall, or run npm run bridge in a clone."**
The download is incomplete. With npx, run the start command again. In a clone of this repository, run `npm run bridge` first.

**"The plant does not run on Windows yet. Use it inside WSL."**
Open a WSL terminal (Ubuntu, for example) and run the commands there. Read the WSL note under [No message, still a problem](#no-message-still-a-problem) first.

**"Another plant (process `<pid>`, port `<port>`) took this plant's folder. This one is stopping, so the two do not overwrite each other's threads."**
A second start took the same folder while this one ran, for example after this one was paused and woken. The one that took it keeps running. The next line says where.

- **"Open the plant from the link in that start's terminal."** Use the other start's link.
- **"To use the plant, start it again: `<command>`"** No other start holds the folder now. Run the command.

**"The plant could not take `<folder>/bridge.lock`: `<reason>`. Pick a folder on a disk of this computer, for example ~/.plant-67."**
The folder sits on a disk that cannot hold the plant's lock, such as some network or cloud drives. Use a folder on this computer's own disk.

**"The plant could not write `<folder>/start`: `<reason>`. Check there is room on the disk, then start again."**
Usually a full disk. Free some space and start again.

**"The plant could not take `<folder>/bridge.lock`. If no plant is running, delete that file and start again."**
Several starts raced for the folder. Check no plant is running: `pgrep -fl 'the-peoples-plant-67|cli.mjs'` prints nothing when none is. Only then delete that file and start again.

**"The plant failed: `<reason>`"**
Something the plant did not expect stopped it. Please [open an issue](https://github.com/People-sPlant-67/the-peoples-plant-67/issues) with the whole message and your system. Leave out the plant's link.

**"The `<harness>` hooks run a Node that is no longer on this computer (`<path>`), so they fail. Run: `<command>`"**
You upgraded or removed the Node your hooks were installed with. Run the printed hooks command again: it rewires them to the Node you have now.

## The command line

**"--port needs a number from 1025 to 65535."** Give the port as a number, for example `--port 6768`.

**"--dir needs a folder."** Put the folder after `--dir`, for example `--dir ~/plant-work`.

**"Write the folder's full path, for example `<home>`/plant. The plant does not read `<~name>`."** Write the full path. The plant reads `~` and `~/folder`, but not another user's home such as `~someone`.

**"Say which harness: hooks claude, or hooks codex."** Add `claude` or `codex` after `hooks`.

**"The plant does not know "`<word>`". Try --help."** Check the spelling. `--help` lists every option.

**"--notify is for hooks codex only."** Only Codex has a notify program. Drop `--notify`.

**"--remove and --notify go with hooks claude or hooks codex."** Use them after `hooks claude` or `hooks codex`.

## The plant's folder

The plant keeps its files in `~/.plant-67`, or the folder given with `--dir` or `$PLANT67_DIR`. Whatever can write to that folder can put words in your agents' prompts, so the plant checks it hard. [SECURITY.md](../SECURITY.md) says why.

**"That is your home folder itself. Keep the plant's files in a folder of their own inside it, for example ~/.plant-67."**
Give the plant a folder of its own, such as `~/.plant-67`.

**"`<folder>` is inside the project at `<project>`. An agent working there could change what the plant runs. Keep the plant's files outside every project, for example in ~/.plant-67."**
An agent in that project could edit the plant's files. Pick a folder outside every project.

**"`<folder>` could not be read, so the plant will not use it."**
Check the folder exists and you can read it, or pick another.

**"`<path>` should be a folder, and it is not, so the plant will not use it."**
A file has the name the plant expects for a folder. Move the file, or pick another folder.

**"`<path>` is a link, so the plant will not use it. Give the plant a real folder."**
The folder, or something in it, is a symbolic link. Use a real folder.

**"`<path>` belongs to another user, so the plant will not use it. Pick a folder of your own."**
Pick a folder you own, inside your home.

**"`<folder>` is in a folder other users can change (`<parent>`), so the plant will not keep its files there. Use a folder inside your home, for example ~/.plant-67."**
Shared folders such as `/tmp` are out. Use a folder inside your home.

**"Other users can write to `<path>`, so the plant will not use it. Run: chmod -R go-w "`<folder>`""**
Run the printed command. It takes away other users' right to write there.

**"Your group can write to `<path>`, so the plant will not use it. Run: chmod -R g-w "`<folder>`""**
Run the printed command.

**"Your group can write to `<parent>`, so the plant will not keep its files below it. Run: chmod g-w "`<parent>`""**
Pick a folder inside your home, such as `~/.plant-67`. Run the printed command only on a folder that is yours and that nobody else relies on: never on a system folder such as `/Applications`.

**"The plant cannot make `<folder>`, because you do not have permission there. Pick a folder of your own, for example ~/.plant-67."**
Pick a folder inside your home.

**"The plant cannot make `<folder>`, because part of that path is a file, not a folder. Pick another folder, for example ~/.plant-67."**
Pick another folder.

**"The plant cannot make `<folder>`: `<reason>`"**
Something else stopped it, such as a full or read-only disk. The reason says which.

## Wiring Claude Code or Codex

**"`<settings file>` is not valid JSON, so the plant changed nothing. Fix that file first, then run this again."**
Your harness's settings file has a typo. Fix it (your harness also reports it), then run the hooks command again.

**"The "hooks" in `<settings file>` are not in the shape the plant expects, so it changed nothing. Fix that file first, then run this again."**
The `hooks` entry in that file is not the shape the harness documents. Fix it, then run the command again.

**"`<config.toml>` already has a notify program, and Codex allows only one, so the plant changed nothing. Use the hooks instead (run this without --notify), or swap the line by hand."**
Use `hooks codex` without `--notify`. Recent Codex versions have hooks, which the plant prefers.

**"The plant cannot write a safe hook command for a path holding quotes, backslashes, $ or backticks: `<path>`"**
Your Node, the hook script or the plant's folder sits under a path with one of those characters. Move the plant's folder with `--dir`, or install Node somewhere plainer.

**"The plant only writes hook commands with full paths, and this one is not: `<path>`"**
This should not happen. Please open an issue with the path it printed.

**"The `<harness>` hooks pointed at the plant in `<old folder>`. They now point at `<new folder>`, so the plant in `<old folder>` no longer hears from `<harness>`."**
A warning. One harness reports to one plant folder at a time. Run the hooks command with the other `--dir` to switch back.

## The plant's page

**"The plant does not answer this tab. If it has stopped, start it again with:"**
The plant stopped, or its terminal closed. Start it again with the command shown. Each start gives a new link, so close this tab and use the new one.

**"This tab is from before the plant last started. Use the newest link the plant printed, or start the plant again with:"**
The plant restarted since this tab opened. Use the newest link in its terminal.

**"This page does not have the plant's current key. Open the plant from the link in the terminal where it started."**
The page lost its key, or was opened without the link. Open the link the plant printed. Lost it? Run the start command again: it prints the link of the plant already running.

**"The plant does not open at this address. Open it from the link in the terminal where it started."**
The plant lives at its own address, `http://p67-<letters>.localhost:<port>`. Plain `localhost:6767` shows only this note. Open the printed link.

**"This is an old address of the plant. The plant's address changes each time it starts. Open the plant from the newest link in the terminal where it started, and close this tab."**
A bookmark or an old tab. Open the newest link.

**"Another start of the plant took this folder, so this one is stopping. Open the plant from the link in that start's terminal."**
See the same case under [Starting the plant](#starting-the-plant).

**"The plant keeps a few choices only, and these are too many."** and **"The plant keeps choices as names and words only."**
A choice did not save. Reload the tab. If it keeps happening, open an issue.

**"The plant could not keep your choices on this computer."**
The plant could not write `prefs.json` in its folder. Its terminal says "Could not save prefs.json:" and the reason. Check there is room on the disk.

## Answers to a signed request

Adapter authors meet these when calling the bridge with `scripts/plant-api.mjs` or their own code. The plant's page never should.

| Answer | Why |
|---|---|
| "This bridge only answers at the plant's own address." | The request named a host the bridge does not know. Use the address in the plant's link. (Plain `localhost` gets the page saying where the plant is.) |
| "Only the plant itself may send to the bridge." | A POST came from another page's origin. |
| "The bridge takes JSON only." | A POST without `content-type: application/json`. |
| "That is too big for the bridge." | The body is over the bridge's limit. |
| "The body is not JSON." | The body did not parse. |
| "The bridge failed on that request." | A bug. The bridge's terminal shows "The bridge failed on a request:" and the reason. Please open an issue with it. |

## The extension's options page

These appear on the extension's options page (Form 67-C) after you press Connect.

- **"Nothing answered at `<address>`. Start Paperclip, or press Change address and check the address and port."** Paperclip is not running there, or the port is wrong. If you open Paperclip with `http://`, type `http://` in front of the address.
- **"Something answered at `<address>`, but it does not look like Paperclip. Press Change address and check the address and port."** Another program answers there. Check the port.
- **"That address sends visitors on to `<new address>`. Press Change address and type `<new address>`."** Paperclip lives at the new address. Type that one.
- **"That address sends visitors somewhere else. Paperclip may live at `<guess>`."** Open the guessed address in a new tab. If Paperclip opens, use that address.
- **"A sign-in page answered at `<address>`."** Fine: Paperclip sits behind a sign-in. Press Open the plant, sign in, then press Open the plant again.
- **"Chrome did not give permission, so the plant cannot open there. Press Connect and choose Allow."** The plant needs Chrome's permission for that one site to draw inside your Paperclip tab.
- **"Chrome no longer lets the plant draw on `<address>`. Press Connect to allow it again, or forget this address."** The site's permission was removed in Chrome's settings. Connect again to restore it.
- **"Only web addresses work here."** and **"That is not a web address."** Type the address you open Paperclip at, such as `localhost:3100` or `paperclip.example.com`.
- **"Chrome could not finish connecting"**, **"Chrome could not disconnect"**, **"Chrome could not forget it"** or **"Chrome could not read the saved address"**, each with Chrome's reason. Try again, or reload the options page. If it keeps happening, reload the extension's card in `chrome://extensions`.

Inside the plant, **"The plant cannot read Paperclip right now. It will keep trying."** means Paperclip stopped answering. When your sign-in has lapsed, the notice offers a link to the Paperclip dashboard: sign in there. The notice closes by itself once the plant can read Paperclip again.

## No message, still a problem

**The browser did not open.** Open the link the plant printed. On Ubuntu, a browser installed as a snap often cannot open the plant's page by itself.

**No comrade appears after wiring.** Start a *new* session in a project folder: a session that was open before the wiring is not hooked. For Codex, type `/hooks` in Codex and trust the plant's hooks. Check the plant and the hooks use the same folder: the hooks command and the start command need the same `--dir`.

**A directive is not picked up.** Directives reach the agent with the next prompt you type in its terminal. The agent reads it then, and its answer comes back in the plant.

**A comrade waits with a red flag.** The agent asked for your OK in its terminal (a permission prompt). Answer it there.

**"Inside WSL, the browser runs on the Windows side, which the plant cannot check. A program there could take this port. Use the plant in WSL only on a computer nobody else uses."**
The plant says this at every start inside WSL. Its checks cover Linux only, and the browser runs on Windows. On a computer only you use, carry on.

**"command not found: npx"** (or `node`). Node is not installed. Install the LTS version from [nodejs.org](https://nodejs.org/), then open a new terminal and run the command again.

**Node is too old.** The plant needs Node 20.19 or newer (on Node 22, 22.12 or newer). `node --version` says which you have. Install the LTS version from [nodejs.org](https://nodejs.org/) to update.

Still stuck? [Open an issue](https://github.com/People-sPlant-67/the-peoples-plant-67/issues) with the exact sentence the plant printed, your system, and `node --version`. Leave out the plant's link: it carries the key.
