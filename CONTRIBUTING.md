# Contributing

Thank you for building the plant with us. Adapters for other harnesses are the most wanted work: [docs/ADAPTERS.md](docs/ADAPTERS.md) explains them, and lists good first ones. Bug fixes, art, sounds and words are welcome too.

## Set up

You need Node 22 or newer to run the tests. (The plant itself runs on Node 20.19 or newer, but the test suite needs Node 22.) macOS or Linux; on Windows, use WSL.

```bash
git clone https://github.com/People-sPlant-67/the-peoples-plant-67.git
cd the-peoples-plant-67
npm ci
```

`npm ci` also builds the bridge into `dist-bridge/`, and points git at `.githooks`, so every push runs the leak scan first.

## Check your work

```bash
npm run bridge
npm test
npm run typecheck
```

- **Run `npm run bridge` before `npm test`** whenever you change anything under `src/bridge/`. The start tests drive the built command in `dist-bridge/`, and they fail on purpose when the build is stale.
- A test that measures render time can fail on a busy computer. Run it again before you believe it.
- Never run the tests while you use the plant for real: they expect `~/.plant-67` to be absent. They never touch your `~/.claude` or `~/.codex`.

## Work on the plant

```bash
npm run dev
```

Open the address it prints. The first page lists every way in: the plant on the built-in mock Paperclip, each scenario (a tribunal, a hire, a purge and more), the founding form's variants, and the art previewer. No Paperclip, bridge or agents needed. `src/cockpit/dev-entry.ts` explains each query parameter.

The other builds:

| Command | Makes |
|---|---|
| `npm run bridge` | The `npx` command, in `dist-bridge/`. Run it with `node dist-bridge/cli.mjs`. |
| `npm run ext` | The Chrome extension, in `dist-extension/`. Load it unpacked in `chrome://extensions`. |
| `npm run demo` | The public demo, static files in `dist-demo/`. |
| `npm run build` | All three, after a typecheck. |
| `npm run onboarding` | `docs/ONBOARDING.md`, from `src/live/onboarding.ts`. A test keeps them equal. |

To try the bridge without disturbing a plant you use, give it a folder and port of its own, inside your home folder (the plant refuses shared folders such as `/tmp`):

```bash
node dist-bridge/cli.mjs --port 6797 --dir "$(mktemp -d "$HOME/plant-try.XXXXXX")"
```

`node scripts/plant-api.mjs <that folder> GET /api/companies` sends it a signed request from the terminal, as the plant's page does. It is the quickest way to see what an adapter's files look like to the plant.

## The leak scan

This project is published under a pseudonym. `npm run leak-scan` checks what you are about to publish for email addresses, token-shaped strings and home-folder paths, in the files and in every commit. The pre-push hook runs it, and so does CI. If it stops you, it says where it found the match. Take it out, and amend the commit if the match is already in one. Use made-up names in examples and tests, never a real person's.

## Words

The plant's words follow a few rules. Short, plain, declarative sentences. No dashes as punctuation. The Soviet flavour lives in headings, captions and the art; instructions stay plain. Every sentence the bridge prints for a failure needs an entry in [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md): a test fails until it has one.

## Send a change

1. Open an issue first for anything larger than a fix, so two people do not build the same thing.
2. Keep each pull request to one change, with tests.
3. Run `npm test`, `npm run typecheck` and `npm run leak-scan` before you push.
4. Say what you changed and how you checked it.

Report security problems privately, as [SECURITY.md](SECURITY.md) explains.

By contributing, you agree your work is published under the [MIT licence](LICENSE).
