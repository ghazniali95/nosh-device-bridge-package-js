# Nosh Device Bridge — JavaScript client

**Print receipts to a local thermal printer from any website or Node app.**

This is the JavaScript companion to the **Nosh Device Bridge** desktop app (a
self-hosted [QZ Tray](https://qz.io/) alternative). The desktop app runs on the
shop's computer next to the printer. This tiny library lets your web page or Node
service talk to it and print ESC/POS receipts — no drivers, no browser plugins.

Works everywhere from **one package**:

- **Browser** `<script>` tag or CDN → gives you `window.DeviceBridge`
- **Node / bundlers** (`import`) → `import { DeviceBridge, Receipt }`
- **CommonJS** (`require`) → `const { DeviceBridge, Receipt } = require(...)`

---

## How it works (30-second version)

```
 Your app (browser or Node)          Cashier's PC
 ──────────────────────────          ─────────────
 opens a WebSocket to the    ───▶     Nosh Device Bridge app
 local bridge and asks it to          → talks to the printer
 print a receipt              ◀───     → replies { printed: true }
```

1. **Connect** to the bridge (it lives on `127.0.0.1`).
2. **Pair once** — the user clicks **Approve** in the desktop app. You get back
   an `appId` + `secret`. Save them.
3. **Print** — build a receipt and send it. Every request is signed so it can't
   be forged or replayed.

---

## Install

Pick the line that matches how you build your app. You only need **one**.

### Option A — npm / yarn / pnpm (Node, React, Vue, Next, bundlers)

```bash
# Install straight from this GitHub repo (works today):
npm install github:ghazniali95/nosh-device-bridge-package-js

# …or, once it's published to the npm registry, the short form will be:
npm install nosh-device-bridge
```

Then import it:

```js
import { DeviceBridge, Receipt } from "nosh-device-bridge";
```

> **Node version note.** On **Node 22+** nothing else is needed — WebSocket and
> crypto are built in. On **older Node** (18–21) also install a WebSocket:
> `npm install ws`. The package picks it up automatically.

### Option B — plain `<script>` tag (any website, no build step)

Two ways, depending on whether you can reach the CDN:

```html
<!-- 1) From a CDN (once published to npm) -->
<script src="https://unpkg.com/nosh-device-bridge"></script>

<!-- 2) Self-hosted: copy dist/nosh-device-bridge.cjs next to your page -->
<script src="./nosh-device-bridge.cjs"></script>
```

Either way you get two globals to use: **`window.DeviceBridge`** and
**`window.NoshReceipt`**.

---

## Quick start

### Browser

```html
<script src="https://unpkg.com/nosh-device-bridge"></script>
<script>
  async function printTest() {
    const db = new DeviceBridge({ appName: "My POS" });

    await db.connect();                 // finds the local bridge
    const creds = await db.pair();      // user clicks Approve in the app
    // 👉 SAVE creds.appId + creds.secret (send to your server) — pair only once.

    const receipt = NoshReceipt.make()
      .title("NOSH")
      .item("Coffee", 1, "£2.50")
      .total("TOTAL", "£2.50", true)
      .footer("Thank you!")
      .cut();

    await db.printReceipt(receipt, "127.0.0.1", 9100);
  }
</script>
```

Already paired before? Skip pairing and reuse your saved credentials:

```js
const db = new DeviceBridge({ appName: "My POS" });
db.useCredentials(savedAppId, savedSecret);
await db.connect();
await db.printReceipt(receipt, "127.0.0.1", 9100);
```

### Node

```js
import { DeviceBridge, Receipt } from "nosh-device-bridge";

const db = new DeviceBridge({ appName: "Kitchen service" });
await db.connect();
db.useCredentials(process.env.BRIDGE_APP_ID, process.env.BRIDGE_SECRET);

const receipt = Receipt.make()
  .title("NOSH")
  .item("Cheeseburger", 2, "£17.00", ["No pickles"])
  .item("Fries", 1, "£3.50")
  .total("TOTAL", "£20.50", true)
  .cut();

console.log(await db.printReceipt(receipt, "127.0.0.1", 9100));
db.disconnect();
```

(CommonJS is the same, just `const { DeviceBridge, Receipt } = require("nosh-device-bridge");`.)

---

## Building receipts

`Receipt.make()` gives you a fluent builder. Chain calls, end with `.cut()`.

| Method | What it does |
|---|---|
| `.title(t)` / `.subtitle(s)` | Header title / subtitle |
| `.info(...lines)` | Centered lines under the title (address, phone) |
| `.line(text, opts)` | A free-form text line |
| `.item(name, qty, price, notes)` | A line item (+ optional notes) |
| `.total(label, value, bold)` | A totals row |
| `.footer(...lines)` | Footer lines |
| `.qr(value)` / `.barcode(value)` | Print a QR / barcode |
| `.openDrawer()` | Kick the cash drawer |
| `.cut(on = true)` | Cut the paper |

---

## The client API

| Method | What it does |
|---|---|
| `new DeviceBridge(opts)` | `opts`: `url`, `appName`, `appId`, `secret`, `timeout`, `allowInsecure` |
| `connect()` | Connects (tries `wss://…:8442`, falls back to `ws://…:8443`) |
| `pair()` | Asks the user to approve; returns `{ appId, secret }`. **Do once.** |
| `useCredentials(appId, secret)` | Reuse saved credentials (skip pairing) |
| `ping()` | Health check |
| `listPrinters()` | List printers the bridge can reach |
| `printReceipt(receipt, host, port, copies)` | Print a receipt to a network printer |
| `printRaw(data, host, port, copies)` | Send raw text/ESC-POS bytes |
| `sign(action, payload)` | Build a signed message without sending it |
| `relay(signedMessage)` | Send a message that was signed elsewhere (e.g. your server) |
| `disconnect()` | Close the connection |

---

## Keeping the secret safe (recommended for production)

The simplest setup keeps the `secret` in the browser — fine for local dev, but
anyone with the page can read it. For production, **sign on your server** and let
the browser only relay:

1. Your server holds the `secret` and builds a **signed** message (use our
   [PHP package](https://github.com/ghazniali95/nosh-device-bridge-package), or
   `db.sign(...)` in a Node backend).
2. The browser fetches that signed message and relays it as-is:

```js
const db = new DeviceBridge();
await db.connect();

const signed = await (await fetch("/pos/print/123", { method: "POST" })).json();
const result = await db.relay(signed);   // sent verbatim — do not modify it
console.log(result); // { printed: true }
```

> `relay()` sends the message exactly as received. Any change breaks the signature.

---

## Security

- Every request is signed with **HMAC-SHA256** over `id|action|ts|nonce|payload`,
  with a timestamp (±30s) and a one-time nonce — so requests can't be forged or
  replayed.
- Uses the built-in Web Crypto in browsers and modern Node; falls back to Node's
  `crypto` module automatically.

---

## License

MIT.
