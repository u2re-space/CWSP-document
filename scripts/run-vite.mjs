#!/usr/bin/env node
/**
 * Run Vite under a larger V8 heap. npm workspaces and some shells drop NODE_OPTIONS;
 * this wrapper always passes --max-old-space-size so dev/build don't OOM at ~4 GiB.
 *
 * Override: VITE_NODE_HEAP_MB=8192 node scripts/run-vite.mjs dev
 * Large monorepo + Vite 8 dep scan can exceed 16 GiB; raise if you still OOM (e.g. 32768).
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const vitePkgRoot = dirname(require.resolve("vite/package.json"));
const viteJs = resolve(vitePkgRoot, "bin", "vite.js");

const heapMb = String(process.env.VITE_NODE_HEAP_MB || "24576").trim() || "24576";
const forwarded = process.argv.slice(2);
const args = [`--max-old-space-size=${heapMb}`, viteJs, ...forwarded];

const r = spawnSync(process.execPath, args, { stdio: "inherit", shell: false });
process.exit(r.status ?? 1);
