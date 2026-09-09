/**
 * ESM entry point.
 *
 * Modern apps and bundlers do:  import { DeviceBridge, Receipt } from "nosh-device-bridge";
 * This just re-exports the classes from the UMD build so there's a single source of truth.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../dist/nosh-device-bridge.cjs");

export const DeviceBridge = pkg.DeviceBridge;
export const Receipt = pkg.Receipt;
export default pkg.DeviceBridge;
