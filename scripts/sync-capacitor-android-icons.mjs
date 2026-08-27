/*
 * Filename: sync-capacitor-android-icons.mjs
 * FullPath: apps/CWSP-document/scripts/sync-capacitor-android-icons.mjs
 * FIND:sku
 * Change date and time: 15.35.00_27.08.2026
 * Reason for changes: Document APK mipmaps from src/pwa/icons, not Phosphor books.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sot = [
    path.resolve(APP_ROOT, "../CWSP-shell/scripts/sync-capacitor-android-icons.mjs"),
    path.resolve(APP_ROOT, "../../apps/CWSP-shell/scripts/sync-capacitor-android-icons.mjs")
].find((p) => fs.existsSync(p));
if (!sot) throw new Error("sync-capacitor-android-icons.mjs (shell) not found");
const r = spawnSync(process.execPath, [sot, "--app", APP_ROOT], { stdio: "inherit" });
process.exit(r.status ?? 1);
