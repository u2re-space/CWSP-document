#!/usr/bin/env node
/*
 * Filename: stage-cw-markdown.mjs
 * FullPath: apps/CrossWord/scripts/stage-cw-markdown.mjs
 * Change date and time: 22.20.00_19.07.2026
 * Reason for changes: Stage CrossWord markdown SPA → runtime/fastify/apps/cw-markdown.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(path.dirname(root));
const src = path.join(root, "build/cw-markdown");
const dest = path.join(repoRoot, "runtime/fastify/apps/cw-markdown");

if (!fs.existsSync(path.join(src, "index.html"))) {
    console.error(`[stage-cw-markdown] missing ${src}/index.html — run build:cw-markdown first`);
    process.exit(1);
}

fs.mkdirSync(path.dirname(dest), { recursive: true });

const keep = new Set(["README.md"]);
if (fs.existsSync(dest)) {
    for (const name of fs.readdirSync(dest)) {
        if (keep.has(name)) continue;
        fs.rmSync(path.join(dest, name), { recursive: true, force: true });
    }
} else {
    fs.mkdirSync(dest, { recursive: true });
}

for (const name of fs.readdirSync(src)) {
    fs.cpSync(path.join(src, name), path.join(dest, name), { recursive: true });
}

fs.writeFileSync(
    path.join(dest, ".sync-meta.json"),
    JSON.stringify(
        {
            syncedAt: new Date().toISOString(),
            source: "apps/CrossWord/build/cw-markdown",
            host: "md.u2re.space",
            debugPath: "/markdown"
        },
        null,
        2
    ) + "\n"
);

console.log(`[stage-cw-markdown] ${src} → ${dest}`);
