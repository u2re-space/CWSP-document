const NODE_BIN = process.execPath;
const fs = require("fs");
const path = require("path");

const resolveValue = (value) => {
    if (Array.isArray(value)) return value.join(",");
    return value && typeof value === "string" ? value.trim() : "";
};
const isPortableConfigArg = (value) => resolveValue(value).length > 0;

const extractArg = (flag) => {
    const args = Array.isArray(process.argv) ? process.argv : [];
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === flag) {
            const next = resolveValue(args[index + 1]);
            if (isPortableConfigArg(next)) return next;
            continue;
        }
        if (arg.startsWith(`${flag}=`)) {
            const next = resolveValue(arg.slice(flag.length + 1));
            if (isPortableConfigArg(next)) return next;
        }
    }
    return "";
};

const extractConfigArg = () => extractArg("--config");
const extractDataArg = () => extractArg("--data");

const resolvePortableConfigPath = () => {
    const explicitArg = resolveValue(extractConfigArg());
    const explicitEnv = resolveValue(process.env.CWS_PORTABLE_CONFIG_PATH);
    const fallback = path.resolve(__dirname, "portable.config.json");
    const source = isPortableConfigArg(explicitArg) ? explicitArg : isPortableConfigArg(explicitEnv) ? explicitEnv : fallback;
    if (!isPortableConfigArg(source)) return "";
    return path.isAbsolute(source) ? source : path.resolve(process.cwd(), source);
};

const readLauncherEnv = (portableConfigPath) => {
    if (!isPortableConfigArg(portableConfigPath)) return {};
    try {
        const raw = fs.readFileSync(portableConfigPath, "utf8");
        const parsed = JSON.parse(raw);
        const launcherEnv = parsed && typeof parsed === "object" && parsed.launcherEnv;
        if (!launcherEnv || typeof launcherEnv !== "object") return {};
        return Object.fromEntries(Object.entries(launcherEnv).map(([key, value]) => {
            if (Array.isArray(value)) {
                return [key, value.join(",")];
            }
            return [key, value];
        }).filter(([, value]) => value !== undefined));
    } catch {
        return {};
    }
};

const portableConfigPath = resolvePortableConfigPath();
const launcherEnv = readLauncherEnv(portableConfigPath);
const envFromFile = Object.assign({}, launcherEnv);
if (portableConfigPath) {
    envFromFile.CWS_PORTABLE_CONFIG_PATH = portableConfigPath;
}

const explicitDataArg = resolveValue(extractDataArg());
if (explicitDataArg) {
    envFromFile.CWS_PORTABLE_DATA_PATH = path.isAbsolute(explicitDataArg) ? explicitDataArg : path.resolve(process.cwd(), explicitDataArg);
}

const normalizeEnvValue = (value) => {
    if (Array.isArray(value)) return value.join(",");
    return (value === true || value === false || typeof value === "number" ? String(value) : resolveValue(value));
};
for (const [key, value] of Object.entries(envFromFile)) {
    envFromFile[key] = normalizeEnvValue(value);
}

module.exports = {
    apps: [
        {
            name: "cws",
            cwd: __dirname,
            // Use Node.js absolute binary directly to prevent npm/cmd invocation drift.
            script: NODE_BIN,
            args: ["./node_modules/tsx/dist/cli.mjs", "server/index.ts"],
            interpreter: "none",
            exec_mode: "fork",
            instances: 1,
            windowsHide: true,
            watch: true,
            watch_delay: 2000,
            restart_delay: 2000,
            min_uptime: 5000,
            max_restarts: 20,
            ignore_watch: ["node_modules", ".git", ".cursor", "dist", "portable", ".data", "run.out.log", "run.err.log", "portable-build.json"],
            watch_options: {
                followSymlinks: false
            },
            env: {
                CWS_BRIDGE_ENDPOINTS: ["https://192.168.0.200:8443/", "https://45.147.121.152:8443/"],
                CWS_ROLES: "responser-initiated,requestor-initiated,responser-initiator,requestor-initiator",
                NODE_ENV: "production",
                CWS_TUNNEL_DEBUG: true,
                CWS_AIRPAD_VERBOSE: 1,
                CWS_PORTABLE_CONFIG_PATH: path.resolve(__dirname, "portable.config.json"),
                CWS_PORTABLE_DATA_PATH: path.resolve(__dirname, ".data"),
                CWS_ASSOCIATED_TOKEN: "n3v3rm1nd",
                CWS_AIRPAD_NATIVE_ACTIONS: "true",
                CWS_AIRPAD_ROBOTJS_ENABLED: "true",
                CWS_CLIPBOARD_LOGGING: "false",
                CWS_HTTPS_ENABLED: "true",
                CWS_HTTPS_KEY: path.resolve(__dirname, "https/local/multi.key"),
                CWS_HTTPS_CERT: path.resolve(__dirname, "https/local/multi.crt"),
                CWS_HTTPS_CA: path.resolve(__dirname, "https/local/rootCA.crt"),
                CWS_BRIDGE_REJECT_UNAUTHORIZED: "false",
                ...envFromFile
            }
        }
    ]
};
