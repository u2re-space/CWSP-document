/*
 * Filename: build-capacitor.mjs
 * FullPath: apps/CWSP-document/scripts/build-capacitor.mjs
 * FIND:sku
 * Change date and time: 15.40.00_27.08.2026
 * Reason for changes: Bump platforms/android/version.properties on each APK build.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHELL_SCRIPTS = path.resolve(APP_ROOT, "../CWSP-shell/scripts");
const ANDROID_ROOT = path.join(APP_ROOT, "platforms/android");

function run(cmd, args, cwd = APP_ROOT, env) {
    console.log(`[build:capacitor] ${cmd} ${args.join(" ")}`);
    const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, ...(env || {}) } });
    if (r.status !== 0) throw new Error(`${cmd} failed`);
}

function resolveJavaHome() {
    if (process.env.JAVA_HOME && fs.existsSync(path.join(process.env.JAVA_HOME, "bin/java"))) {
        return process.env.JAVA_HOME;
    }
    for (const home of [
        process.env.JAVA_HOME_21,
        "/usr/lib/jvm/java-21-openjdk-amd64",
        "/usr/lib/jvm/java-17-openjdk-amd64"
    ].filter(Boolean)) {
        if (fs.existsSync(path.join(home, "bin/java"))) return home;
    }
    return process.env.JAVA_HOME || "";
}

run(process.execPath, [path.join(SHELL_SCRIPTS, "project-sibling-sku-android.mjs"), "document"]);
const noBump =
    process.argv.includes("--no-bump") || String(process.env.CWSP_CAPACITOR_NO_BUMP || "").trim() === "1";
if (noBump) {
    console.log("[build:capacitor] --no-bump — keeping platforms/android/version.properties");
} else {
    run(process.execPath, [path.join(SHELL_SCRIPTS, "bump-capacitor-version.mjs"), "--app", APP_ROOT]);
}
run(process.execPath, [path.join(APP_ROOT, "scripts/sync-capacitor-android-icons.mjs")]);
run(process.execPath, [path.join(APP_ROOT, "scripts/run-vite.mjs"), "build", "--config", "vite.config.js", "--mode", "capacitor"]);
run(process.execPath, [path.join(SHELL_SCRIPTS, "sync-sibling-sku-web.mjs"), "document"]);

const javaHome = resolveJavaHome();
const env = {
    ANDROID_HOME: process.env.ANDROID_HOME || "/home/u2re-dev/Android/Sdk",
    ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || "/home/u2re-dev/Android/Sdk"
};
if (javaHome) env.JAVA_HOME = javaHome;
run("./gradlew", ["--no-daemon", "assembleDebug", "copyCwspApks"], ANDROID_ROOT, env);
console.log("[build:capacitor] document APK ready under build/capacitor/apk");
