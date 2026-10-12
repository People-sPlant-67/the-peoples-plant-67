# Security

The plant draws your agents and lets you send them words. Words sent to an agent end up in its prompt, with your authority. So the plant guards two things: who can reach your agents through it, and who can put words in their way.

## Reporting a problem

Please report security problems privately, through the repository's **Security** tab: [Report a vulnerability](https://github.com/People-sPlant-67/the-peoples-plant-67/security/advisories/new). Do not open a public issue for one. Say what you found, how to reproduce it, and what it lets someone do. You will get an answer, and credit in the release notes if you want it.

In scope: the bridge (`src/bridge/`), the hook script it installs, the plant's page, the Chrome extension (`src/extension/`), and the leak scan. Paperclip, Claude Code and Codex are their own projects: report their problems to them.

## The bridge (Claude Code and Codex)

The bridge is the `npx` command. It runs on your computer and serves the plant to your browser.

**Its own address, new at every start.** The bridge listens on this computer's loopback addresses only (`127.0.0.1` and `[::1]`). It serves the plant at an address of its own, `http://p67-<16 hex>.localhost:<port>`, with a fresh name each start. At any other address (plain `localhost`, or an earlier start's name) it serves only a short page saying where the plant is. That page clears the browser's cache and storage for its address, and a service worker found anywhere on the port removes itself. Nothing an earlier start, or another program, left behind in the browser can follow the plant to its new address.

**A key that never travels.** Each start makes a new key. It sits in the plant's link after the `#`, which browsers never send to a server, and in the folder's `bridge.lock`, readable by you alone. The page signs every request with it: a fresh nonce never used before, the time (refused when more than two minutes off), the method, the path and a hash of the body. The bridge signs every answer to a signed request back, over the status and body. A program that takes the port after the plant stops never sees the key, cannot sign as the page, and cannot sign as the bridge, so the page believes nothing it says. Anything that sends your words to an agent checks the plant first.

**A folder that is yours alone.** The plant's folder (`~/.plant-67` unless you choose another) holds what your agents will read. The bridge closes it to other users, and refuses a folder that:

- other users or your group can write to, or sits under one they can change (shared folders such as `/tmp` included);
- belongs to another user, or is a link;
- lies inside a project, where an agent could change what the plant runs;
- is your home folder itself.

It reads plain files only, never links or pipes. The hook script checks the folder the same way before it hands anything to an agent, and never makes the folder itself.

**One bridge per folder.** A start listens first, then takes the folder by linking `bridge.lock` into place, which fails if a lock is there. A lock is taken over only when its process has gone, when it names this start's own port, or when what answers on its port cannot prove it holds that lock's key. The running bridge checks the lock before every signed request and every five seconds. A plant that was paused while a newer start took its folder refuses requests when it wakes, and stops. It never answers from an old copy of your threads.

**The hooks.** `hooks claude` and `hooks codex` edit your harness's settings: they back the file up first, change nothing if it does not parse, and leave your other hooks alone. `--remove` takes the plant's hooks out again. The hook commands use full paths, and the plant refuses to write one for a path holding quotes, backslashes, `$` or backticks.

## The Chrome extension (Paperclip)

- It stores one thing: the address of your Paperclip. No passwords, no tokens, no keys.
- The plant runs inside your own Paperclip tab, on Paperclip's own 404 page, and uses the sign-in you already have there. It sees what you can see there and nothing more.
- Chrome asks your permission for that one site when you connect. Connecting elsewhere or disconnecting gives back the single-site permissions it asked for before. A wider permission you granted in Chrome yourself is left alone.
- Everything from Paperclip is put on the page as text, never as raw HTML.

## Known limits

- **Programs running as you.** Anything that runs under your own user account can read your files, the plant's key included, and write to the plant's folder. The plant cannot defend against that, nor can any program. Run only adapters and tools you trust.
- **WSL.** Inside WSL, the browser runs on the Windows side, which the plant's checks cannot see. A Windows program could take the plant's port. The plant says so at every start. Use it in WSL only on a computer nobody else uses.
- **Two tabs, one choice.** When two tabs change the same choice at the same moment, the later change wins.
- **Rules in prompts.** The Ministry's Lessons and the tribunal threshold are instructions to your agents. Agents can ignore instructions. The plant flags a referral below your regime's threshold, and never reads a Lesson's text.
- **The link is the key.** Anyone holding the plant's link can reach your agents until the plant stops. Keep it to yourself, and leave it out of screenshots and bug reports. Paste it only into the address bar: the plant never asks for it on a page.
