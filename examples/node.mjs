/**
 * Node example — run:  node examples/node.mjs
 *
 * Needs the Nosh Device Bridge desktop app running on this machine.
 * On Node < 22, also install a WebSocket:  npm i ws
 */
import { DeviceBridge, Receipt } from "../src/index.js";

const db = new DeviceBridge({ appName: "Node Demo" });

// 1) Connect (tries wss://127.0.0.1:8442, falls back to ws://127.0.0.1:8443)
const conn = await db.connect();
console.log("connected:", conn);

// 2) Health check
console.log("ping:", await db.ping());

// 3) Pair — APPROVE the prompt in the desktop app. Store creds for next time.
//    Next runs: db.useCredentials(appId, secret) instead of pairing again.
const creds = await db.pair();
console.log("paired appId:", creds.appId);

// 4) See what printers the bridge can reach
console.log("printers:", await db.listPrinters());

// 5) Build + print a receipt to a network printer (host/port)
const receipt = Receipt.make()
  .title("NOSH")
  .subtitle("Node test")
  .item("Coffee", 1, "£2.50")
  .item("Muffin", 2, "£4.00")
  .total("TOTAL", "£6.50", true)
  .footer("Thank you!")
  .cut();

console.log("printReceipt:", await db.printReceipt(receipt, "127.0.0.1", 9100));

db.disconnect();
