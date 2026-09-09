/**
 * Nosh Device Bridge — universal JavaScript client (UMD build).
 *
 * Works in three environments from one file:
 *   • Browser <script> tag / CDN  → sets window.DeviceBridge and window.NoshReceipt
 *   • CommonJS (require)          → module.exports = { DeviceBridge, Receipt }
 *   • Node / bundlers             → imported by ../src/index.js (ESM wrapper)
 *
 * It lets any web app or Node service talk to the Nosh Device Bridge desktop app
 * running on the same machine as the printer, and print ESC/POS receipts.
 *
 * Typical flow:
 *   const db = new DeviceBridge({ appName: "My POS" });
 *   await db.connect();                 // tries wss://…:8442, falls back to ws://…:8443
 *   const creds = await db.pair();      // user clicks Approve in the desktop app — STORE creds
 *   // next time: db.useCredentials(creds.appId, creds.secret)
 *   await db.printReceipt(
 *     Receipt.make().title("NOSH").item("Coffee", 1, "£2.50").cut(),
 *     "127.0.0.1", 9100
 *   );
 *
 * Every request after pairing is signed (HMAC-SHA256) with a timestamp + one-time
 * nonce, so it can't be forged or replayed.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;              // CommonJS: const { DeviceBridge, Receipt } = require(...)
    module.exports.default = api.DeviceBridge;
  } else {
    root.DeviceBridge = api.DeviceBridge; // Browser global (for <script> tags)
    root.NoshReceipt = api.Receipt;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // --- environment helpers (resolved lazily so the file loads anywhere) -------
  const nodeRequire =
    typeof require === "function" ? require : null;

  function getWebSocket() {
    if (typeof globalThis !== "undefined" && globalThis.WebSocket) return globalThis.WebSocket;
    if (nodeRequire) {
      try { return nodeRequire("ws"); } catch (e) { /* not installed */ }
    }
    throw new Error(
      "No WebSocket available. In Node < 22, install one: npm i ws"
    );
  }

  async function hmacSha256Hex(secretHex, message) {
    const g = typeof globalThis !== "undefined" ? globalThis : {};
    const subtle = g.crypto && g.crypto.subtle;
    if (subtle) {
      const enc = new TextEncoder();
      const key = await subtle.importKey(
        "raw", enc.encode(secretHex), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
      );
      const buf = await subtle.sign("HMAC", key, enc.encode(message));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    if (nodeRequire) {
      const c = nodeRequire("crypto");
      return c.createHmac("sha256", secretHex).update(message).digest("hex");
    }
    throw new Error("No crypto available for HMAC signing");
  }

  function toBase64(data) {
    if (typeof data === "string") {
      if (typeof btoa === "function") return btoa(unescape(encodeURIComponent(data)));
      return Buffer.from(data, "utf8").toString("base64");
    }
    // bytes (Uint8Array / Buffer / number[])
    if (typeof Buffer !== "undefined") return Buffer.from(data).toString("base64");
    let bin = "";
    const arr = new Uint8Array(data);
    for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return btoa(bin);
  }

  function uuid() {
    const g = typeof globalThis !== "undefined" ? globalThis : {};
    if (g.crypto && g.crypto.randomUUID) return g.crypto.randomUUID();
    return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }

  // wss://host:8442 → ws://host:8443 (secure port + 1). Leaves ws:// URLs as-is.
  function deriveInsecureUrl(url) {
    try {
      const u = new URL(url);
      if (u.protocol === "ws:") return url;
      u.protocol = "ws:";
      const p = Number(u.port || 8442);
      u.port = String(p + 1);
      return u.toString().replace(/\/$/, "");
    } catch (e) {
      return url;
    }
  }

  // ---------------------------------------------------------------------------
  // Receipt — a small fluent builder that produces the JSON the bridge expects.
  // ---------------------------------------------------------------------------
  class Receipt {
    constructor() {
      this.spec = {};
    }
    static make() { return new Receipt(); }

    title(t) { (this.spec.header ||= {}).title = t; return this; }
    subtitle(s) { (this.spec.header ||= {}).subtitle = s; return this; }
    info(...lines) { (this.spec.header ||= {}).info = lines.flat().filter(Boolean); return this; }

    line(text, opts = {}) {
      (this.spec.lines ||= []).push({ text, ...opts });
      return this;
    }
    item(name, qty, price, notes) {
      const it = { name };
      if (qty != null) it.qty = qty;
      if (price != null) it.price = price;
      if (notes && notes.length) it.notes = Array.isArray(notes) ? notes : [notes];
      (this.spec.items ||= []).push(it);
      return this;
    }
    total(label, value, bold = false) {
      (this.spec.totals ||= []).push({ label, value, bold });
      return this;
    }
    footer(...lines) { this.spec.footer = lines.flat().filter(Boolean); return this; }
    qr(value) { this.spec.qr = value; return this; }
    barcode(value) { this.spec.barcode = value; return this; }
    openDrawer() { this.spec.openDrawer = true; return this; }
    cut(on = true) { this.spec.cut = on; return this; }

    toArray() { return this.spec; }
    toJob() { return { type: "receipt", data: this.spec }; }
  }

  // ---------------------------------------------------------------------------
  // DeviceBridge — the client.
  // ---------------------------------------------------------------------------
  class DeviceBridge {
    constructor(opts = {}) {
      this.url = opts.url || "wss://127.0.0.1:8442";
      this.insecureUrl = opts.insecureUrl || deriveInsecureUrl(this.url);
      this.allowInsecure = opts.allowInsecure !== false; // default on for local dev
      this.appName = opts.appName || "Unnamed app";
      this.appId = opts.appId || null;
      this.secret = opts.secret || null;
      this.timeout = opts.timeout || 20000;
      this.ws = null;
      this.activeUrl = null;
      this._pending = new Map();
    }

    useCredentials(appId, secret) { this.appId = appId; this.secret = secret; return this; }

    /** Connect, trying wss:// first then falling back to ws:// if allowed. */
    async connect() {
      try {
        await this._open(this.url);
        this.activeUrl = this.url;
      } catch (err) {
        if (!this.allowInsecure || this.insecureUrl === this.url) throw err;
        await this._open(this.insecureUrl);
        this.activeUrl = this.insecureUrl;
      }
      return { url: this.activeUrl, secure: this.activeUrl.startsWith("wss://") };
    }

    _open(url) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const WS = getWebSocket();
        const ws = new WS(url);
        this.ws = ws;
        ws.onopen = () => { settled = true; resolve(); };
        ws.onerror = () => { if (!settled) { settled = true; reject(new Error("connection failed: " + url)); } };
        ws.onclose = () => {
          if (!settled) { settled = true; reject(new Error("connection closed: " + url)); }
          for (const { reject: rj } of this._pending.values()) rj(new Error("connection closed"));
          this._pending.clear();
        };
        ws.onmessage = (ev) => {
          let msg;
          try { msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString()); } catch (e) { return; }
          const p = this._pending.get(msg.id);
          if (!p) return;
          this._pending.delete(msg.id);
          msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error || "error"));
        };
      });
    }

    isConnected() { return this.ws && this.ws.readyState === 1; } // 1 = OPEN
    disconnect() { if (this.ws) this.ws.close(); }

    _rawSend(message) {
      return new Promise((resolve, reject) => {
        if (!this.isConnected()) return reject(new Error("not connected — call connect() first"));
        this._pending.set(message.id, { resolve, reject });
        this.ws.send(JSON.stringify(message));
        setTimeout(() => {
          if (this._pending.has(message.id)) {
            this._pending.delete(message.id);
            reject(new Error("timeout waiting for " + message.action));
          }
        }, this.timeout);
      });
    }

    ping() { return this._rawSend({ id: uuid(), action: "ping" }); }

    /** Request pairing. Blocks until the user approves/denies in the desktop app. */
    async pair() {
      const res = await this._rawSend({
        id: uuid(),
        action: "pair.request",
        payload: { appName: this.appName },
      });
      this.appId = res.appId;
      this.secret = res.secret;
      return res; // { appId, secret, agent, version }
    }

    /** Build a signed message (does NOT send it). Handy if you sign on a server. */
    async sign(action, payload) {
      if (!this.appId || !this.secret) throw new Error("not paired — call pair() first");
      const id = uuid();
      const ts = Date.now();
      const nonce = uuid();
      const base = id + "|" + action + "|" + ts + "|" + nonce + "|" + JSON.stringify(payload ?? null);
      const sig = await hmacSha256Hex(this.secret, base);
      return { id, action, payload, appId: this.appId, ts, nonce, sig };
    }

    async _signedSend(action, payload) {
      return this._rawSend(await this.sign(action, payload));
    }

    listPrinters() { return this._signedSend("printers.list"); }

    /** Low-level: send any { printer, job, copies } payload. */
    print(payload) { return this._signedSend("print", payload); }

    /** Print a Receipt (or raw spec object) to a network/TCP printer. */
    printReceipt(receipt, host = "127.0.0.1", port = 9100, copies = 1) {
      const job = receipt instanceof Receipt
        ? receipt.toJob()
        : { type: "receipt", data: (receipt && receipt.data) || receipt };
      return this.print({ printer: { type: "network", host, port: Number(port) }, job, copies });
    }

    /** Send raw text or bytes (ESC/POS) to a network/TCP printer. */
    printRaw(data, host = "127.0.0.1", port = 9100, copies = 1) {
      return this.print({
        printer: { type: "network", host, port: Number(port) },
        job: { type: "raw", data: toBase64(data) },
        copies,
      });
    }

    /**
     * Relay a message that was already signed elsewhere (e.g. by the PHP/Laravel
     * package on your server). Sent VERBATIM — do not mutate it.
     */
    relay(signedMessage) {
      if (!signedMessage || !signedMessage.id) {
        return Promise.reject(new Error("relay() needs a signed message with an id"));
      }
      return this._rawSend(signedMessage);
    }
  }

  return { DeviceBridge, Receipt };
});
