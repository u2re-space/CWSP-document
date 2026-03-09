#!/usr/bin/env node

import { cp, mkdir, rm, writeFile, chmod, stat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const PORTABLE_DIR = path.resolve(ROOT_DIR, "portable");
const BUNDLE_DIR = path.resolve(PORTABLE_DIR, "endpoint-portable");

const normalizePortList = (raw, fallback = []) => {
    const list = typeof raw === "string" ? raw.split(",") : Array.isArray(raw) ? raw : [];
    const normalized = list
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .map((value) => value.replace(/\\/g, "/"));
    return normalized.length ? normalized : fallback;
};

const toInt = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const boolValue = (value, fallback = false) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
        if (value.trim() === "") return fallback;
        return value.trim().toLowerCase() === "true";
    }
    return fallback;
};

const stringifyLauncherValue = (value) => {
    if (Array.isArray(value)) return value.join(",");
    if (typeof value === "string") return value;
    if (typeof value === "boolean") return value ? "true" : "false";
    if (typeof value === "number") return String(value);
    return "";
};

const mergePortableConfig = (base, patch) => {
    const result = { ...base };
    for (const [key, value] of Object.entries(patch || {})) {
        if (value == null) continue;
        if (Array.isArray(value)) {
            result[key] = [...value];
            continue;
        }
        if (typeof value === "object" && typeof base?.[key] === "object" && !Array.isArray(base[key])) {
            result[key] = mergePortableConfig(base[key], value);
            continue;
        }
        result[key] = value;
    }
    return result;
};

const DEFAULT_PORTABLE_CONFIG = {
    version: 2,
    portableModules: {
        core: "./config/portable-core.json",
        endpoint: "./config/portable-endpoint.json"
    },
    build: {
        copyMode: "auto",
        outputDir: "",
        skipOutputCopy: false,
        nodeModulesMode: "none",
        includeNodeModules: false,
        archiveRetentionCount: 1,
        preserveTargets: ["node_modules", ".data", ".endpoint.config.json", ".config.endpoint.json", "portable.config.json"]
    },
    remote: {
        host: "192.168.0.110",
        user: "U2RE",
        port: 22,
        path: "C:\\\\Users\\\\U2RE\\\\",
        preserveTargets: ["node_modules", ".data", ".endpoint.config.json", ".config.endpoint.json", "portable.config.json"]
    },
    launcherEnv: {
        CWS_TUNNEL_DEBUG: true,
        CWS_SOCKET_IO_ALLOWED_ORIGINS: "all",
        CWS_SOCKET_IO_ALLOW_PRIVATE_NETWORK_ORIGINS: true,
        CWS_SOCKET_IO_ALLOW_UNKNOWN_ORIGIN_WITH_AUTH: true,
        CWS_CORS_ALLOW_PRIVATE_NETWORK: true,
        CWS_START_MODE: "start"
    }
};

const loadPortableConfig = async () => {
    const configPath = process.env.PORTABLE_CONFIG_PATH
        ? path.resolve(process.env.PORTABLE_CONFIG_PATH)
        : path.resolve(ROOT_DIR, "portable.config.json");
    try {
        const raw = await readFile(configPath, "utf-8");
        const parsed = JSON.parse(raw);
        return mergePortableConfig(DEFAULT_PORTABLE_CONFIG, parsed || {});
    } catch {
        return DEFAULT_PORTABLE_CONFIG;
    }
};

const PORTABLE_CONFIG = await loadPortableConfig();

const PORTABLE_OUTPUT_DIR = String(
    process.env.PORTABLE_OUTPUT_DIR || PORTABLE_CONFIG.build?.outputDir || ""
).trim();
const PORTABLE_COPY_MODE = String(process.env.PORTABLE_COPY_MODE || PORTABLE_CONFIG.build?.copyMode || "auto").toLowerCase();
const ENABLE_PORTABLE_OUTPUT_COPY = String(process.env.PORTABLE_SKIP_OUTPUT_COPY || "").toLowerCase() !== "true" && !boolValue(PORTABLE_CONFIG.build?.skipOutputCopy, false);
const PORTABLE_REMOTE_HOST = String(process.env.PORTABLE_REMOTE_HOST || PORTABLE_CONFIG.remote?.host || "192.168.0.110").trim();
const PORTABLE_REMOTE_USER = String(process.env.PORTABLE_REMOTE_USER || PORTABLE_CONFIG.remote?.user || "").trim();
const PORTABLE_REMOTE_PORT = toInt(process.env.PORTABLE_REMOTE_PORT || process.env.PORTABLE_SSH_PORT, toInt(PORTABLE_CONFIG.remote?.port, 22));
const PORTABLE_REMOTE_PATH = String(process.env.PORTABLE_REMOTE_PATH || PORTABLE_CONFIG.remote?.path || "C:\\Users\\U2RE\\").trim();
const PORTABLE_INCLUDE_NODE_MODULES = boolValue(process.env.PORTABLE_INCLUDE_NODE_MODULES, boolValue(PORTABLE_CONFIG.build?.includeNodeModules, false));
const PORTABLE_PRESERVE_TARGETS = new Set(
    normalizePortList(
        process.env.PORTABLE_PRESERVE_TARGETS || PORTABLE_CONFIG.build?.preserveTargets || PORTABLE_CONFIG.remote?.preserveTargets || [],
        normalizePortList([], [...(PORTABLE_CONFIG.build?.preserveTargets || []), ...(PORTABLE_CONFIG.remote?.preserveTargets || [])])
    )
);

const EXCLUDED_TOP_LEVEL = new Set([
    "node_modules",
    "assets",
    "portable",
    "dist",
    ".git",
    ".cursor",
    "windows_use",
    "tests"
]);

const nodeModulesMode = String(process.env.PORTABLE_NODE_MODULES_MODE || PORTABLE_CONFIG.build?.nodeModulesMode || "none").toLowerCase();
const includeNodeModules = nodeModulesMode === "copy" || nodeModulesMode === "ci";
const archiveRetentionCount = toInt(process.env.PORTABLE_ARCHIVE_RETENTION_COUNT || PORTABLE_CONFIG.build?.archiveRetentionCount, 3);
const nowStamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const archiveFlavor = includeNodeModules ? `with-node_modules-${nodeModulesMode}` : "slim";
const archiveName = `endpoint-portable-${archiveFlavor}-${nowStamp}.tar.gz`;
const archivePath = path.resolve(PORTABLE_DIR, archiveName);
const archivePattern = /^endpoint-portable-(with-node_modules-(?:copy|ci)|slim)-.+\.tar\.gz$/;

const runOrThrow = (command, args, cwd) => {
    const result = spawnSync(command, args, {
        cwd,
        stdio: "inherit",
        shell: false
    });
    if (result.status !== 0) {
        throw new Error(`Command failed: ${command} ${args.join(" ")}`);
    }
};

const copyEntry = async (name) => {
    if (EXCLUDED_TOP_LEVEL.has(name)) return;
    const src = path.resolve(ROOT_DIR, name);
    const dst = path.resolve(BUNDLE_DIR, name);
    await cp(src, dst, { recursive: true });
};

const copyEndpointSources = async () => {
    const entries = await readdir(ROOT_DIR);
    for (const name of entries) {
        await copyEntry(name);
    }
};

const installNodeModules = async () => {
    if (includeNodeModules && !PORTABLE_INCLUDE_NODE_MODULES) {
        console.log("[portable] Skipping node_modules by policy (set PORTABLE_INCLUDE_NODE_MODULES=true to include).");
        return;
    }

    if (!includeNodeModules) {
        console.log("[portable] Skipping node_modules (slim bundle).");
        return;
    }

    if (nodeModulesMode === "copy") {
        const srcModules = path.resolve(ROOT_DIR, "node_modules");
        const dstModules = path.resolve(BUNDLE_DIR, "node_modules");
        try {
            const info = await stat(srcModules);
            if (!info.isDirectory()) throw new Error("node_modules is not a directory");
            console.log("[portable] Reusing existing node_modules...");
            await cp(srcModules, dstModules, { recursive: true });
            return;
        } catch {
            console.warn("[portable] Existing node_modules not found. Falling back to npm ci...");
            console.log("[portable] Installing dependencies inside portable bundle...");
            runOrThrow("npm", ["ci", "--include=dev"], BUNDLE_DIR);
            return;
        }
    }

    if (nodeModulesMode === "ci") {
        console.log("[portable] Installing dependencies inside portable bundle...");
        runOrThrow("npm", ["ci", "--include=dev"], BUNDLE_DIR);
        return;
    }

    throw new Error(`Unknown PORTABLE_NODE_MODULES_MODE: ${nodeModulesMode}`);
};

const writeLaunchers = async () => {
    const launchEnvEntries = Object.entries(PORTABLE_CONFIG.launcherEnv || {}).filter(([, value]) => value !== undefined);
    const launchShLines = launchEnvEntries.map(
        ([key, value]) => {
            const strVal = stringifyLauncherValue(value);
            return `export ${key}="\${${key}:-${strVal}}"`;
        }
    );
    const launchCmdLines = launchEnvEntries.map(
        ([key, value]) => {
            const strVal = stringifyLauncherValue(value);
            return `if not defined ${key} set "${key}=${strVal}"`;
        }
    );
const runSh = `#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
${launchShLines.join("\n")}
start_mode="\${CWS_START_MODE:-start}"
if command -v pm2 >/dev/null 2>&1; then
  if [ -f "ecosystem.config.cjs" ]; then
    if pm2 describe cws >/dev/null 2>&1; then
      exec pm2 restart cws
    fi
    exec pm2 start ecosystem.config.cjs
  fi
fi
if ! command -v node >/dev/null 2>&1; then
  echo "[portable] Node.js 22+ is required."
  exit 1
fi
if [ ! -f "node_modules/.bin/tsx" ]; then
  echo "[portable] Installing dependencies (first run)..."
  npm ci --include=dev || npm install --include=dev
fi
if [ "$start_mode" = "watch" ] || [ "$start_mode" = "1" ] || [ "$start_mode" = "true" ] || [ "$start_mode" = "dev" ]; then
  npm run start:watch
else
  npm run start
fi
`;

    const runCmd = `@echo off
setlocal
cd /d "%~dp0"
${launchCmdLines.join("\n")}
set "CWS_START_MODE=%CWS_START_MODE%"
if "%CWS_START_MODE%"=="" if "%CWS_START_MODE%"=="" set "CWS_START_MODE=start"
if "%CWS_START_MODE%"=="" set "CWS_START_MODE=%CWS_START_MODE%"
where pm2 >nul 2>&1
if not errorlevel 1 (
  if exist ecosystem.config.cjs (
    for /f "delims=" %%N in ('pm2 describe cws --no-color 2^>nul ^| findstr /C:"cws"') do (
      set "HAS_PM2_APP=1"
    )
    if defined HAS_PM2_APP (
      call pm2 restart cws --update-env
    ) else (
      call pm2 start ecosystem.config.cjs
    )
    if errorlevel 1 (
      echo [portable] PM2 failed to start service.
      pause
      exit /b 1
    )
    exit /b 0
  )
)
where node >nul 2>&1
if errorlevel 1 (
  echo [portable] Node.js 22+ is required.
  pause
  exit /b 1
)
if not exist "node_modules\\.bin\\tsx.cmd" (
  echo [portable] Installing dependencies ^(first run^)^...
  call npm ci --include=dev
  if errorlevel 1 (
    echo [portable] npm ci failed, retrying with npm install...
    call npm install --include=dev
    if errorlevel 1 (
      echo [portable] Failed to install dependencies.
      pause
      exit /b 1
    )
  )
)

:portable_pm2_fallback
if /I "%CWS_START_MODE%"=="watch" (
  start "" /B /D "%~dp0" npm.cmd run start:watch
) else (
  start "" /B /D "%~dp0" npm.cmd run start
)
exit /b 0
`;

    const installNote = includeNodeModules
        ? "- This package includes local node_modules for portability."
        : "- This is a slim bundle without node_modules. Run: npm ci --include=dev";

    const launcherEnvNotes = launchEnvEntries.length
        ? launchEnvEntries.map(([key, value]) => `  - ${key}=${stringifyLauncherValue(value)}`).join("\n")
        : "  - No custom launcher defaults.";

    const readme = `# Endpoint portable bundle

This bundle is generated from apps/CrossWord/src/endpoint.

## Requirements
- Node.js 22+ and npm

## Run
- Linux/macOS: ./run.sh
- Windows: run.cmd

## Notes
- Node modules mode: ${nodeModulesMode}
${installNote}
- Slim mode auto-installs dependencies on first run via npm.
- Launcher starts \`npm run start\` (\`server/index.ts\`) to preserve full legacy WS/Socket.IO control stack.
- Default launcher environment:
${launcherEnvNotes}
- Set \`CWS_START_MODE=watch\` to run auto-restart on file changes from the launcher (\`start:watch\`).
- Archive retention is controlled by \`PORTABLE_ARCHIVE_RETENTION_COUNT\` (default: ${archiveRetentionCount}) in build mode.
- If clipboard backend is unavailable on Linux headless environments, endpoint still starts.
`;

    const runShPath = path.resolve(BUNDLE_DIR, "run.sh");
    const runCmdPath = path.resolve(BUNDLE_DIR, "run.cmd");
    const readmePath = path.resolve(BUNDLE_DIR, "README.PORTABLE.md");

    await writeFile(runShPath, runSh, "utf-8");
    await writeFile(runCmdPath, runCmd, "utf-8");
    await writeFile(readmePath, readme, "utf-8");
    await chmod(runShPath, 0o755);
};

const createArchive = () => {
    console.log(`[portable] Creating archive: ${archivePath}`);
    runOrThrow("tar", ["-czf", archivePath, "endpoint-portable"], PORTABLE_DIR);
};

const prunePortableArchives = async (targetDir) => {
    if (!Number.isFinite(archiveRetentionCount) || archiveRetentionCount <= 0) return;
    const limit = Math.max(1, Math.floor(archiveRetentionCount));
    const entries = await readdir(targetDir, { withFileTypes: true }).catch(() => []);
    const archived = [];
    for (const entry of entries || []) {
        if (!entry.isFile() || !archivePattern.test(entry.name)) continue;
        try {
            const fullPath = path.resolve(targetDir, entry.name);
            const info = await stat(fullPath);
            archived.push({ fullPath, mtime: info.mtimeMs });
        } catch {
            continue;
        }
    }
    archived.sort((a, b) => b.mtime - a.mtime);
    const removals = archived.slice(limit);
    for (const item of removals) {
        try {
            await rm(item.fullPath, { force: true });
            console.log(`[portable] Removed old archive: ${item.fullPath}`);
        } catch {
            // best effort cleanup
        }
    }
};

const normalizeWindowsPath = (value) => String(value || "").trim();

const resolveLocalMirrorDir = () => {
    if (PORTABLE_OUTPUT_DIR) return path.resolve(PORTABLE_OUTPUT_DIR);
    if (PORTABLE_CONFIG.build?.outputDir) return path.resolve(PORTABLE_CONFIG.build.outputDir);
    if (process.platform === "win32") {
        return "C:\\Users\\U2RE\\endpoint-portable";
    }
    return "";
};

const getRemoteTarget = () => {
    if (!PORTABLE_REMOTE_HOST) return "";
    return PORTABLE_REMOTE_USER ? `${PORTABLE_REMOTE_USER}@${PORTABLE_REMOTE_HOST}` : PORTABLE_REMOTE_HOST;
};

const isWindowsDrivePath = (value) => /^[A-Za-z]:[\\/]/.test(value || "");

const normalizeSshWindowsPath = (value) => {
    const normalized = normalizeWindowsPath(value).replace(/\\/g, "\\");
    return normalized.replace(/\/+$/g, "");
};

const toPowerShellEncodedCommand = (value) => {
    const utf16Bytes = Buffer.from(`${value}`, "utf16le");
    return utf16Bytes.toString("base64");
};

const runRemoteCommand = (remoteTarget, command) => {
    runOrThrow("ssh", [...(Number.isFinite(PORTABLE_REMOTE_PORT) ? ["-p", String(PORTABLE_REMOTE_PORT)] : []), remoteTarget, command]);
};

const copyRemoteToWindows = async (remoteTarget) => {
    const remoteArchiveName = path.basename(archivePath);
    const remoteStageDir = `endpoint-portable-stage-${nowStamp}`;
    const remoteDestination = normalizeSshWindowsPath(PORTABLE_REMOTE_PATH);
    const escapedDestination = remoteDestination.replace(/'/g, "''");
    const preservedEntries = Array.from(PORTABLE_PRESERVE_TARGETS).map((entry) => `'${entry.replace(/'/g, "''")}'`).join(", ");
    const powershellScript = `$dest = '${escapedDestination}';
$homeDir = if ($env:USERPROFILE) { $env:USERPROFILE } elseif ($env:HOME) { $env:HOME } else { $HOME };
$stageUploadTarget = Join-Path $homeDir '${remoteStageDir}';
$stageArchive = Join-Path $homeDir '${remoteArchiveName}';
$archiveDest = Join-Path $dest '${remoteArchiveName}';
$preserve = @(${preservedEntries});
$stageManifest = Join-Path $stageUploadTarget 'portable-build.json';
$nestedStageManifest = Join-Path (Join-Path $stageUploadTarget 'endpoint-portable') 'portable-build.json';

function ConvertTo-Backslashes([string]$value) {
  return $value -replace '/','\\';
}

$stagingPath = if (Test-Path -LiteralPath $stageManifest) {
  $stageUploadTarget
} elseif (Test-Path -LiteralPath $nestedStageManifest) {
  Join-Path $stageUploadTarget 'endpoint-portable'
} else {
  throw "Stage upload incomplete: portable-build.json not found in $stageUploadTarget";
}
if (!(Test-Path -LiteralPath $dest)) { New-Item -ItemType Directory -Path $dest -Force | Out-Null; }

if (Test-Path -LiteralPath $stageArchive) {
  Copy-Item -Path $stageArchive -Destination $archiveDest -Force;
  Remove-Item -Force -LiteralPath $stageArchive;
}

if (Test-Path -LiteralPath $dest) {
  Get-ChildItem -LiteralPath $dest -Force | ForEach-Object {
    if ($preserve -contains $_.Name) { return }
    Remove-Item -Recurse -Force -LiteralPath $_.FullName;
  }
} else {
  New-Item -ItemType Directory -Path $dest -Force | Out-Null;
}
Get-ChildItem -LiteralPath $stagingPath -Force | ForEach-Object {
  $targetPath = Join-Path $dest $_.Name;
  $isPreserved = $preserve -contains $_.Name;
  if ($isPreserved -and (Test-Path -LiteralPath $targetPath)) {
    if ($_.PSIsContainer) {
      Get-ChildItem -Path $_.FullName -Force | Copy-Item -Destination (ConvertTo-Backslashes $targetPath) -Recurse -Force;
    }
    return;
  }
  if (!($preserve -contains $_.Name) -or !(Test-Path -LiteralPath $targetPath)) {
    Copy-Item -Path $_.FullName -Destination $dest -Recurse -Force;
  }
}
Remove-Item -Recurse -Force -LiteralPath $stageUploadTarget;`;

    try {
        console.log(`[portable] Remote Windows path detected (${PORTABLE_REMOTE_PATH}). Using SSH staging workflow ...`);
        runOrThrow("scp", [
            ...(Number.isFinite(PORTABLE_REMOTE_PORT) ? ["-P", String(PORTABLE_REMOTE_PORT)] : []),
            "-r",
            BUNDLE_DIR,
            `${remoteTarget}:./${remoteStageDir}`
        ]);
        runOrThrow("scp", [
            ...(Number.isFinite(PORTABLE_REMOTE_PORT) ? ["-P", String(PORTABLE_REMOTE_PORT)] : []),
            archivePath,
            `${remoteTarget}:./${remoteArchiveName}`
        ]);
        runRemoteCommand(remoteTarget, `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${toPowerShellEncodedCommand(powershellScript)}`);
        console.log(`[portable] Remote bundle and archive copied via Windows staging to ${remoteTarget}:${remoteDestination}`);
        return true;
    } catch (error) {
        console.warn(`[portable] Windows SSH staging copy failed: ${error?.message || error}`);
        return false;
    }
};

const copyRemote = async () => {
    const remoteTarget = getRemoteTarget();
    if (!remoteTarget) {
        console.log("[portable] Remote mirror skipped: PORTABLE_REMOTE_HOST is not set.");
        return false;
    }
    if (!PORTABLE_REMOTE_PATH) {
        console.log("[portable] Remote mirror skipped: PORTABLE_REMOTE_PATH is not set.");
        return false;
    }

    const isWindowsDestination = isWindowsDrivePath(PORTABLE_REMOTE_PATH);
    const remoteDestination = normalizeSshWindowsPath(PORTABLE_REMOTE_PATH);

    if (isWindowsDestination) {
        return copyRemoteToWindows(remoteTarget);
    }

    const remoteDestinationPosix = remoteDestination.replace(/\\/g, "/");
    const remoteArchivePath = `${remoteDestinationPosix}/${path.basename(archivePath)}`;
    const scpPortArgs = Number.isFinite(PORTABLE_REMOTE_PORT) ? ["-P", String(PORTABLE_REMOTE_PORT)] : [];

    try {
        console.log(`[portable] Ensure remote folder exists: ${remoteTarget}:${remoteDestinationPosix}`);
        runRemoteCommand(remoteTarget, `mkdir -p "${remoteDestinationPosix}"`);
        console.log(`[portable] Remote mirroring bundle to ${remoteTarget}:${remoteDestination} via SCP ...`);
        runOrThrow("scp", [
            ...scpPortArgs,
            "-r",
            BUNDLE_DIR,
            `${remoteTarget}:${remoteDestination}`
        ]);
        console.log(`[portable] Remote bundle mirror complete: ${remoteTarget}:${remoteDestination}`);
        return true;
    } catch (error) {
        console.warn(`[portable] SCP folder copy failed: ${error?.message || error}`);
    }

    try {
        console.log(`[portable] Remote archive mirror to ${remoteTarget}:${remoteArchivePath} ...`);
        runOrThrow("scp", [
            ...scpPortArgs,
            archivePath,
            `${remoteTarget}:${remoteArchivePath}`
        ]);
        console.log(`[portable] Archive mirrored to ${remoteTarget}:${remoteArchivePath}`);
        return true;
    } catch (error) {
        console.warn(`[portable] Remote archive copy failed: ${error?.message || error}`);
        return false;
    }
};

const copyToConfiguredOutput = async () => {
    if (!ENABLE_PORTABLE_OUTPUT_COPY) {
        console.log("[portable] Output mirror skipped by PORTABLE_SKIP_OUTPUT_COPY.");
        return;
    }
    const mode = PORTABLE_COPY_MODE;
    const localTarget = resolveLocalMirrorDir();
    const doLocal = mode === "local" || mode === "auto";
    const doRemote = mode === "remote" || mode === "auto";

    if (doLocal && localTarget) {
        const outputBundleDir = path.resolve(localTarget);
        const outputArchive = path.resolve(path.dirname(outputBundleDir), path.basename(archivePath));
        const outputEntryExists = async (entryPath) => {
            try {
                await stat(entryPath);
                return true;
            } catch {
                return false;
            }
        };
        try {
            console.log(`[portable] Mirroring bundle to local path ${outputBundleDir} ...`);
            try {
                const outputEntries = await readdir(outputBundleDir, { withFileTypes: true });
                for (const entry of outputEntries) {
                    if (PORTABLE_PRESERVE_TARGETS.has(entry.name)) continue;
                    await rm(path.resolve(outputBundleDir, entry.name), { recursive: true, force: true });
                }
            } catch {
                // output path is absent, nothing to clean
            }
            await mkdir(path.dirname(outputBundleDir), { recursive: true });
            const bundleEntries = await readdir(BUNDLE_DIR, { withFileTypes: true });
            for (const entry of bundleEntries) {
                const sourceEntry = path.resolve(BUNDLE_DIR, entry.name);
                const targetEntry = path.resolve(outputBundleDir, entry.name);
                const existsTarget = await outputEntryExists(targetEntry);
                if (PORTABLE_PRESERVE_TARGETS.has(entry.name) && existsTarget) {
                    if (entry.isDirectory()) {
                        await mkdir(targetEntry, { recursive: true });
                        const sourceChildren = await readdir(sourceEntry, { withFileTypes: true });
                        for (const child of sourceChildren) {
                            await cp(
                                path.resolve(sourceEntry, child.name),
                                path.resolve(targetEntry, child.name),
                                { recursive: true }
                            );
                        }
                    }
                    continue;
                }
                await cp(sourceEntry, targetEntry, { recursive: true });
            }
            await cp(archivePath, outputArchive, { force: true });
            await prunePortableArchives(path.dirname(outputArchive));
            console.log(`[portable] Local mirror complete: ${outputBundleDir}`);
            console.log(`[portable] Local archive mirrored: ${outputArchive}`);
            return;
        } catch (error) {
            console.warn(`[portable] Could not mirror to local path "${outputBundleDir}": ${error?.message || error}`);
            if (mode === "local") {
                return;
            }
        }
    }

    if (doRemote) {
        const copied = await copyRemote();
        if (!copied) {
            if (mode === "remote") {
                throw new Error("[portable] Remote mirror failed; build is not complete without a successful remote copy.");
            }
            console.warn("[portable] Remote mirror skipped because destination sync failed in auto mode.");
            return;
        }
    } else if (mode !== "auto") {
        console.log(`[portable] Output mirror skipped: PORTABLE_COPY_MODE="${mode}" has no action.`);
    }
};

const main = async () => {
    console.log("[portable] Preparing output directory...");
    await mkdir(PORTABLE_DIR, { recursive: true });
    await rm(BUNDLE_DIR, { recursive: true, force: true });

    console.log("[portable] Copying endpoint sources...");
    await copyEndpointSources();
    await writeFile(
        path.resolve(BUNDLE_DIR, "portable-build.json"),
        JSON.stringify(
            {
                builtAt: new Date().toISOString(),
                nowStamp,
                tag: archiveName,
                nodeModulesMode,
                includeNodeModules,
                portableConfigPath: process.env.PORTABLE_CONFIG_PATH || null,
                remoteHost: PORTABLE_REMOTE_HOST || null,
                remoteUser: PORTABLE_REMOTE_USER || null
            },
            null,
            2
        ),
        "utf-8"
    );
    await installNodeModules();
    await writeLaunchers();
    createArchive();
    await prunePortableArchives(PORTABLE_DIR);
    await copyToConfiguredOutput();

    console.log(`[portable] Done: ${BUNDLE_DIR}`);
    console.log(`[portable] Archive: ${archivePath}`);
};

main().catch((error) => {
    console.error("[portable] Failed:", error);
    process.exit(1);
});
