/**
 * Type definitions for nosh-device-bridge.
 */

export interface DeviceBridgeOptions {
  /** Secure WebSocket URL. Default: "wss://127.0.0.1:8442" */
  url?: string;
  /** Plain-WS fallback URL. Default: derived from `url` (secure port + 1). */
  insecureUrl?: string;
  /** Allow falling back to ws:// when wss:// fails. Default: true. */
  allowInsecure?: boolean;
  /** Name shown in the desktop app's pairing prompt. */
  appName?: string;
  /** Previously paired app id. */
  appId?: string | null;
  /** Previously paired secret (hex). */
  secret?: string | null;
  /** Per-request timeout in ms. Default: 20000. */
  timeout?: number;
}

export interface Credentials {
  appId: string;
  secret: string;
  agent?: string;
  version?: string;
}

export interface ConnectionInfo {
  url: string;
  secure: boolean;
}

export interface SignedMessage {
  id: string;
  action: string;
  payload?: unknown;
  appId: string;
  ts: number;
  nonce: string;
  sig: string;
}

export interface NetworkPrinter {
  type: "network";
  host: string;
  port: number;
}

export interface PrintJob {
  type: string;
  data: unknown;
}

export interface PrintPayload {
  printer: NetworkPrinter | Record<string, unknown>;
  job: PrintJob;
  copies?: number;
}

export interface ReceiptSpec {
  header?: { title?: string; subtitle?: string; info?: string[] };
  lines?: Array<{ text: string; [key: string]: unknown }>;
  items?: Array<{ name: string; qty?: number | string; price?: number | string; notes?: string[] }>;
  totals?: Array<{ label: string; value: string | number; bold: boolean }>;
  footer?: string[];
  qr?: string;
  barcode?: string;
  openDrawer?: boolean;
  cut?: boolean;
}

/** Fluent builder producing the receipt JSON the bridge expects. */
export class Receipt {
  spec: ReceiptSpec;
  static make(): Receipt;
  title(text: string): this;
  subtitle(text: string): this;
  info(...lines: Array<string | string[]>): this;
  line(text: string, opts?: Record<string, unknown>): this;
  item(name: string, qty?: number | string | null, price?: number | string | null, notes?: string | string[]): this;
  total(label: string, value: string | number, bold?: boolean): this;
  footer(...lines: Array<string | string[]>): this;
  qr(value: string): this;
  barcode(value: string): this;
  openDrawer(): this;
  cut(on?: boolean): this;
  toArray(): ReceiptSpec;
  toJob(): PrintJob;
}

/** Client for the Nosh Device Bridge desktop app. */
export class DeviceBridge {
  constructor(opts?: DeviceBridgeOptions);
  url: string;
  insecureUrl: string;
  allowInsecure: boolean;
  appName: string;
  appId: string | null;
  secret: string | null;
  timeout: number;
  activeUrl: string | null;

  useCredentials(appId: string, secret: string): this;
  connect(): Promise<ConnectionInfo>;
  isConnected(): boolean;
  disconnect(): void;
  ping(): Promise<unknown>;
  pair(): Promise<Credentials>;
  sign(action: string, payload?: unknown): Promise<SignedMessage>;
  listPrinters(): Promise<unknown>;
  print(payload: PrintPayload): Promise<unknown>;
  printReceipt(receipt: Receipt | ReceiptSpec, host?: string, port?: number, copies?: number): Promise<unknown>;
  printRaw(data: string | Uint8Array | number[], host?: string, port?: number, copies?: number): Promise<unknown>;
  relay(signedMessage: SignedMessage): Promise<unknown>;
}

export default DeviceBridge;
