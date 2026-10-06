# The People's Plant #67

Your AI agent org, drawn as a Soviet factory in pixel art - reminiscent of a certain hotel.

Work in progress. The full README lands before release.

```bash
npm ci
npm run demo      # build the demo into dist-demo/, serve it with any static server
npm run dev       # work on the plant; open /cockpit.html
npm run ext       # build the Chrome extension into dist-extension/
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
