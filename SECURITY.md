# Security

The plant draws your agents and lets you send them words. Words sent to an agent end up in its prompt, with your authority. So the plant guards two things: who can reach your agents through it, and who can put words in their way.

## Reporting a problem

Please report security problems privately, through the repository's **Security** tab: [Report a vulnerability](https://github.com/People-sPlant-67/the-peoples-plant-67/security/advisories/new). Do not open a public issue for one. Say what you found, how to reproduce it, and what it lets someone do. Credit in the release notes is yours if you want it.

Only the newest release is supported. In scope: the bridge (`src/bridge/`), the hook script it installs, the plant's page, the Chrome extension (`src/extension/`), and the leak scan. Paperclip, Claude Code and Codex are their own projects: report their problems to them.

## The bridge (Claude Code and Codex)

The bridge is the `npx` command. It runs on your computer and serves the plant to your browser. `npx github:People-sPlant-67/the-peoples-plant-67` runs the newest code on GitHub. To stay on a release you have chosen, add its tag, for example `#v1.0.0`.

**Its own address, new at every start.** The bridge listens on this computer's loopback addresses only (`127.0.0.1` and `[::1]`). It serves the plant at an address of its own, `http://p67-<16 hex>.localhost:<port>`, with a fresh name each start. At `localhost`, `127.0.0.1`, `[::1]` or an earlier start's name, it serves only a short page saying where the plant is. That page asks the browser to clear its cache and storage for that address. A service worker at any of these addresses removes itself at its next update check. Any other host name gets a refusal. The bare addresses also answer another start's question "is a plant here?", so a program on this computer can tell that a plant is running.

**A key that never travels.** Each start makes a new key. It sits in the plant's link after the `#`, which browsers never send to a server, in the terminal that started the plant, in the folder's `bridge.lock` (and, for up to a minute, `open.html`), readable by you alone, and in the tab's own storage. The page signs every request with it: a fresh nonce never used before, the time (refused when more than two minutes off), the method, the path and a hash of the body. Once a request's signature checks out, the bridge signs its answer back, over the status and body. Refusals sent before that check go unsigned: a bad or old signature, a wrong method, another page's origin, a body not marked as JSON, or one that is too big. The page takes nothing from an unsigned answer. It only stops, and sends nothing more. A program that takes the port after the plant stops never sees the key, cannot sign as the page, and cannot sign as the bridge. Anything that sends your words to an agent checks the plant first.

The bridge's pages are sent with a strict content security policy (scripts from the plant only, no `eval`, requests to the plant only), and may not be framed by another site.

**A folder that is yours alone.** The plant's folder (`~/.plant-67` unless you choose another) holds what your agents will read. The bridge closes the folder itself to other users. If you give it a link, it follows that link once and uses the real folder, whose path then goes into every command. When it starts, it refuses a folder that:

- sits under a folder other users or your group can change (shared folders such as `/tmp` included);
- holds files or folders that other users or your group can write to, or links (checked three levels down);
- belongs to another user;
- lies inside a project, where an agent could change what the plant runs;
- is your home folder itself.

It reads what agents and hooks write as plain files only, never links or pipes. Before the hook script hands anything to an agent, it checks the folder is a real folder, yours, outside every project, and that nobody else can write to it or to any folder above it. It never makes the folder itself.

**The hook script lives in one place.** Whatever folder the plant uses, the script your harness runs is `~/.plant-67/hooks/plant-hook.mjs`. Each start that takes its folder replaces an installed hook script with its own version. So a plant started from another copy of this code changes what your harness runs. Start only plants you trust. To try a copy you do trust, such as a branch you are working on, set `HOME` to a scratch folder so it leaves your hook script alone. That is no defence against code you do not trust: it runs as you.

**One bridge per folder.** A start listens first, then takes the folder by linking `bridge.lock` into place, which fails if a lock is there. A lock is taken over only when it cannot be read, when its process has gone, when it names this start's own port, or when what answers on its port cannot prove it holds that lock's key. The running bridge checks the lock before every request that reads or changes your agents, and every five seconds. A plant that was paused while a newer start took its folder refuses requests when it wakes, and stops. It never answers from an old copy of your threads.

**The hooks.** `hooks claude` and `hooks codex` edit your harness's settings. Before their first change to a settings file, they keep a copy of it beside it. They change nothing if the file does not parse, and leave your other hooks alone. `--remove` takes the plant's hooks out again. The hook commands use full paths, and the plant refuses to write one for a path holding double quotes, newlines, backslashes, `$` or backticks.

**Your words, with your authority.** The hook script tells your agent that a directive comes from you, as if you had typed it. Anyone holding the plant's link can send one.

## The Chrome extension (Paperclip)

- The extension stores one thing in Chrome: the address of your Paperclip. No passwords, no tokens, no keys.
- The plant keeps your choices in the browser's storage for your Paperclip site. Among them: your name and portrait (the pixelated one, if you made it from a photo; the photo itself is never kept), the layout and sound, the directives it is tracking, and verdicts not yet carried out. Pages of that site can read them, as they can read anything else stored there.
- The plant runs inside your own Paperclip tab, on Paperclip's own 404 page, and uses the sign-in you already have there. It sees what you can see there and nothing more.
- Chrome asks your permission for your Paperclip's host when you connect. The permission covers every port of that host, such as every server on `localhost`. The plant's script is registered on one path only, `<your Paperclip>/api/plant-67`. Connecting elsewhere or disconnecting gives back every single-host permission but the connected one, even one you added in Chrome yourself. A grant to all sites is left alone.
- Everything from Paperclip is put on the page as text, never as raw HTML.

## Known limits

- **Programs running as you.** Anything that runs under your own user account can read your files, the plant's key included, and write to the plant's folder. The plant cannot defend against that, nor can any program. Run only adapters and tools you trust.
- **WSL.** Inside WSL, the browser runs on the Windows side, which the plant's checks cannot see. A Windows program could take the plant's port. The plant says so at every start. Use it in WSL only on a computer nobody else uses.
- **Two tabs, one choice.** When two tabs change the same choice at the same moment, the later change wins.
- **Rules in prompts.** The Ministry's Lessons and the tribunal threshold are instructions to your agents. Agents can ignore instructions. The plant flags a referral below your regime's threshold, and never reads a Lesson's text.
- **The link is the key.** Anyone holding the plant's link can reach your agents until the plant stops. Keep it to yourself, and leave it out of screenshots and bug reports. Paste it only into the address bar: the plant never asks for it on a page.
- **The link in your browser's history.** The plant takes the key out of the address bar once it has read it, but the browser's history keeps the link as it was opened. A browser that syncs its history copies it to your other devices and your browser account. The key stops working when the plant stops.
