/**
 * ESM entry point.
 *
 * Modern apps and bundlers do:  import { DeviceBridge, Receipt } from "nosh-device-bridge";
 * This just re-exports the classes from the UMD build so there's a single source of truth.
 *
 * Note: this deliberately avoids node: built-ins (no createRequire) so the same
 * file works in browser bundlers (Vite, webpack, Rollup, esbuild) as well as Node.
 */
import pkg from "../dist/nosh-device-bridge.cjs";

export const DeviceBridge = pkg.DeviceBridge;
export const Receipt = pkg.Receipt;
export default pkg.DeviceBridge;
