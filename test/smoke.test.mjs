/**
 * Smoke tests — run:  npm test
 *
 * These don't need the desktop app or a printer; they check the package loads
 * in every module format and that the pure logic (receipts, signing) is right.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHmac } from "node:crypto";
import DefaultExport, { DeviceBridge, Receipt } from "../src/index.js";

const require = createRequire(import.meta.url);

test("ESM entry exports DeviceBridge, Receipt and a default", () => {
  assert.equal(typeof DeviceBridge, "function");
  assert.equal(typeof Receipt, "function");
  assert.equal(DefaultExport, DeviceBridge);
});

test("CommonJS build exports the same classes", () => {
  const cjs = require("../dist/nosh-device-bridge.cjs");
  assert.equal(cjs.DeviceBridge, DeviceBridge);
  assert.equal(cjs.Receipt, Receipt);
  assert.equal(cjs.default, DeviceBridge);
});

test("package resolves by name via exports map", async () => {
  const esm = await import("nosh-device-bridge");
  const cjs = require("nosh-device-bridge");
  assert.equal(esm.DeviceBridge, cjs.DeviceBridge);
});

test("Receipt builder produces the expected job", () => {
  const job = Receipt.make()
    .title("NOSH")
    .subtitle("Test")
    .info("Line A", ["Line B", ""])
    .item("Coffee", 1, "£2.50")
    .item("Muffin", 2, "£4.00", "no butter")
    .total("TOTAL", "£6.50", true)
    .footer("Thanks")
    .qr("https://example.com")
    .openDrawer()
    .cut()
    .toJob();

  assert.deepEqual(job, {
    type: "receipt",
    data: {
      header: { title: "NOSH", subtitle: "Test", info: ["Line A", "Line B"] },
      items: [
        { name: "Coffee", qty: 1, price: "£2.50" },
        { name: "Muffin", qty: 2, price: "£4.00", notes: ["no butter"] },
      ],
      totals: [{ label: "TOTAL", value: "£6.50", bold: true }],
      footer: ["Thanks"],
      qr: "https://example.com",
      openDrawer: true,
      cut: true,
    },
  });
});

test("DeviceBridge defaults and insecure URL derivation", () => {
  const db = new DeviceBridge({ appName: "Test" });
  assert.equal(db.url, "wss://127.0.0.1:8442");
  assert.equal(db.insecureUrl, "ws://127.0.0.1:8443");
  assert.equal(db.allowInsecure, true);
  assert.equal(db.isConnected(), null);
});

test("sign() produces a valid HMAC-SHA256 signature", async () => {
  const db = new DeviceBridge().useCredentials("app-1", "deadbeef");
  const msg = await db.sign("print", { a: 1 });

  const base = [msg.id, msg.action, msg.ts, msg.nonce, JSON.stringify({ a: 1 })].join("|");
  const expected = createHmac("sha256", "deadbeef").update(base).digest("hex");

  assert.equal(msg.appId, "app-1");
  assert.equal(msg.action, "print");
  assert.equal(msg.sig, expected);
  assert.notEqual(msg.id, msg.nonce);
});

test("sign() rejects when not paired", async () => {
  await assert.rejects(new DeviceBridge().sign("print", {}), /not paired/);
});

test("sending without a connection rejects cleanly", async () => {
  await assert.rejects(new DeviceBridge().ping(), /not connected/);
});
