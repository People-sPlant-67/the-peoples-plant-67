# The People's Plant #67

Your AI agent org, drawn as a Soviet factory in pixel art.

Work in progress. The full README lands before release.

```bash
npm ci
npm run demo      # build the demo into dist-demo/, serve it with any static server
npm run dev       # work on the plant; open /cockpit.html
npm run ext       # build the Chrome extension into dist-extension/
```

## Use it with your Paperclip

1. Build the extension with `npm run ext`, or download the zip from Releases and unzip it.
2. Open `chrome://extensions`, switch on Developer mode, press Load unpacked and pick the folder.
3. A page opens. Type the address you open Paperclip at, such as `localhost:3100`, and press Connect.
4. Chrome asks to let the plant "read and change your data" on that one site. That is how it draws inside your Paperclip tab. Choose Allow.
5. Press Open the plant.
6. Pin the plant from the puzzle piece in Chrome's toolbar. Its ★ then opens the plant from anywhere.

The plant stores the address and nothing else. It runs inside your Paperclip tab and uses the sign-in you already have there. To change the address later, right-click the ★ and choose Options.

To update, replace the folder with the new one and press the reload arrow on the plant's card in `chrome://extensions`.

Adapters for other harnesses: see [docs/PLANT-PROTOCOL.md](docs/PLANT-PROTOCOL.md).
