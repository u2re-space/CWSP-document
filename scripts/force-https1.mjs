/**
 * FIND:vite-https1
 * WHY: Vite 8 HTTPS always calls `http2.createSecureServer` (ALPN h2). Chrome then
 * opens HMR as WebSocket-over-h2; `ws` sees those frames as `Invalid frame header`
 * and polls until `location.reload()` — LAN bootloop.
 * ESM `http2.createSecureServer = …` does not replace the named export Vite
 * destructures. CJS `require("node:http2")` mutates the live builtin.
 * INVARIANT: load via `node --import` before `vite.js`, or from vite.config before
 * `resolveHttpServer`.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const http2 = require("node:http2");
const https = require("node:https");

http2.createSecureServer = function createHttps1Server(options, listener) {
    return typeof listener === "function"
        ? https.createServer(options, listener)
        : https.createServer(options);
};
