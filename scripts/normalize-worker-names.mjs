#!/usr/bin/env node
/**
 * Post-build: stable filenames for hashed assets (Vite/Rollup content hashes).
 * Covers: OPFS uniform worker, @jsquash WASM, uniform Worker chunk, etc.
 */
import { promises as fs } from "node:fs";
import { resolve, extname, basename, relative } from "node:path";

const appRoot = resolve(import.meta.dirname, "..");
const TARGET_EXTS = new Set([".js", ".mjs", ".html", ".json", ".css", ".ts"]);

/** [regex, replacement] for in-file rewrites (global) */
const TEXT_REPLACEMENTS = [
    [/(OPFS\.uniform\.worker)-[A-Za-z0-9_-]+(\.m?js)\b/g, "$1$2"],
    [/mozjpeg_dec-[A-Za-z0-9_-]+\.wasm\b/g, "mozjpeg_dec.wasm"],
    [/mozjpeg_enc-[A-Za-z0-9_-]+\.wasm\b/g, "mozjpeg_enc.wasm"],
    [/squoosh_png_bg-[A-Za-z0-9_-]+\.wasm\b/g, "squoosh_png_bg.wasm"],
    [/Worker-[A-Za-z0-9_-]+\.(ts|js|mjs)\b/g, "Worker.$1"],
];

/**
 * If basename matches a known hashed asset, return stable basename; else null.
 */
function stableBasename(file) {
    if (/^OPFS\.uniform\.worker-[A-Za-z0-9_-]+\.m?js$/i.test(file)) {
        return file.replace(/^OPFS\.uniform\.worker-[A-Za-z0-9_-]+(\.m?js)$/i, "OPFS.uniform.worker$1");
    }
    if (/^mozjpeg_dec-[A-Za-z0-9_-]+\.wasm$/i.test(file)) return "mozjpeg_dec.wasm";
    if (/^mozjpeg_enc-[A-Za-z0-9_-]+\.wasm$/i.test(file)) return "mozjpeg_enc.wasm";
    if (/^squoosh_png_bg-[A-Za-z0-9_-]+\.wasm$/i.test(file)) return "squoosh_png_bg.wasm";
    if (/^Worker-[A-Za-z0-9_-]+\.(ts|js|mjs)$/i.test(file)) {
        return file.replace(/^Worker-[A-Za-z0-9_-]+(\.(ts|js|mjs))$/i, "Worker$1");
    }
    return null;
}

function applyRewrites(text) {
    let out = text;
    for (const [re, rep] of TEXT_REPLACEMENTS) {
        out = out.replace(re, rep);
    }
    return out;
}

async function listFilesRecursive(dir) {
    const out = [];
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
        const abs = resolve(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...(await listFilesRecursive(abs)));
        } else {
            out.push(abs);
        }
    }
    return out;
}

async function renameHashedAssets(distDir) {
    const files = await listFilesRecursive(distDir);
    const renamed = [];
    for (const abs of files) {
        const file = basename(abs);
        const stable = stableBasename(file);
        if (!stable) continue;
        const target = resolve(abs, "..", stable);
        if (abs === target) continue;
        await fs.rename(abs, target).catch(async () => {
            await fs.copyFile(abs, target);
            await fs.unlink(abs);
        });
        renamed.push({ from: file, to: stable });
    }
    return renamed;
}

async function rewriteReferences(distDir) {
    const files = await listFilesRecursive(distDir);
    let updated = 0;
    for (const abs of files) {
        if (!TARGET_EXTS.has(extname(abs).toLowerCase())) continue;
        const text = await fs.readFile(abs, "utf8").catch(() => null);
        if (typeof text !== "string") continue;
        const next = applyRewrites(text);
        if (next === text) continue;
        await fs.writeFile(abs, next, "utf8");
        updated++;
    }
    return updated;
}

async function normalizeDir(distPath) {
    const renamed = await renameHashedAssets(distPath);
    const refs = await rewriteReferences(distPath);
    const manifestPatched = await patchCrxManifest(distPath);
    return { distPath, renamed, refs, manifestPatched };
}

function normalizePosixPath(p) {
    return String(p).split("\\").join("/");
}

async function patchCrxManifest(distPath) {
    const manifestPath = resolve(distPath, "manifest.json");
    const manifestText = await fs.readFile(manifestPath, "utf8").catch(() => null);
    if (!manifestText) return false;

    let manifest;
    try {
        manifest = JSON.parse(manifestText);
    } catch {
        return false;
    }

    const files = await listFilesRecursive(distPath);
    const resources = [];
    for (const abs of files) {
        const rel = normalizePosixPath(relative(distPath, abs));
        if (!rel || rel === "manifest.json") continue;
        // Keep internal Vite metadata private; expose runtime payloads.
        if (rel.startsWith(".vite/")) continue;
        resources.push(rel);
    }
    resources.sort();

    const war = Array.isArray(manifest.web_accessible_resources)
        ? manifest.web_accessible_resources
        : [];

    const fullRuntimeEntry = {
        matches: ["<all_urls>", "file://*/*", "file:///*"],
        resources,
        use_dynamic_url: false,
    };

    // Replace prior auto-generated full-runtime entry if present.
    const nextWar = war.filter((entry) => {
        const r = entry?.resources;
        return !(Array.isArray(r) && r.includes("app/content.js"));
    });
    nextWar.push(fullRuntimeEntry);
    manifest.web_accessible_resources = nextWar;

    const nextText = `${JSON.stringify(manifest, null, 2)}\n`;
    if (nextText === manifestText) return false;
    await fs.writeFile(manifestPath, nextText, "utf8");
    return true;
}

async function run() {
    const dirs = [resolve(appRoot, "dist"), resolve(appRoot, "dist-crx")];
    const results = [];
    for (const d of dirs) {
        const stat = await fs.stat(d).catch(() => null);
        if (!stat?.isDirectory()) continue;
        results.push(await normalizeDir(d));
    }

    for (const r of results) {
        if (!r.renamed.length && !r.refs && !r.manifestPatched) continue;
        console.log(`[normalize-dist-assets] ${r.distPath}`);
        for (const n of r.renamed) {
            console.log(`  ${n.from} -> ${n.to}`);
        }
        if (r.refs) {
            console.log(`  updated references in ${r.refs} files`);
        }
        if (r.manifestPatched) {
            console.log("  patched CRX manifest web_accessible_resources");
        }
    }
}

run().catch((error) => {
    console.error("[normalize-dist-assets] Failed:", error);
    process.exit(1);
});
