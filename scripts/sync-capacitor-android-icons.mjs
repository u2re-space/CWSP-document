/*
 * Filename: sync-capacitor-android-icons.mjs
 * FullPath: apps/CWSP-document/scripts/sync-capacitor-android-icons.mjs
 * FIND:sku
 * Change date and time: 13.56.00_24.08.2026
 * Reason for changes: Document APK icon = Phosphor books.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const renderer = [
    path.resolve(APP_ROOT, "../CWSP-shell/scripts/render-sku-android-icon.mjs"),
    path.resolve(APP_ROOT, "../../apps/CWSP-shell/scripts/render-sku-android-icon.mjs")
].find((p) => fs.existsSync(p));
if (!renderer) throw new Error("render-sku-android-icon.mjs not found");
const res = path.join(APP_ROOT, "platforms/android/res");
const r = spawnSync(process.execPath, [renderer, "--icon", "books", "--res", res], { stdio: "inherit" });
process.exit(r.status ?? 1);
