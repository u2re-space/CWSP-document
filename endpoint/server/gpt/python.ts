// =========================
// Python Subprocess Management
// =========================

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { executeActions } from "../io/actions.ts";

let py: any = null;
const pythonSubscribers = new Set<any>();
let app: any = null;
let pythonInitialized = false;
let pythonAvailable = false;
let pythonError: Error | null = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENDPOINT_ROOT = join(__dirname, "..");
const CONTROLLER_PATH = join(ENDPOINT_ROOT, "controller.py");

export function setApp(application: any) {
    app = application;
}

export function getPythonSubscribers(): Set<any> {
    return pythonSubscribers;
}

function setUnavailable(reason: string, error?: unknown) {
    pythonAvailable = false;
    pythonInitialized = false;
    pythonError = error instanceof Error ? error : new Error(reason);
    app?.log?.warn?.({ reason, error }, "[Python] Voice backend is unavailable");
}

function ensurePython() {
    // @ts-ignore - py can be null or ChildProcess
    if (py && py.exitCode === null) {
        pythonAvailable = true;
        return;
    }

    if (!existsSync(CONTROLLER_PATH)) {
        setUnavailable(`Missing controller.py: ${CONTROLLER_PATH}`);
        return;
    }

    pythonInitialized = true;

    const childProcess = spawn("python", [CONTROLLER_PATH], {
        stdio: ["pipe", "pipe", "inherit"],
        cwd: ENDPOINT_ROOT,
        env: {
            ...process.env,
            PYTHONIOENCODING: "utf-8",
            LANG: process.env.LANG || "ru_RU.UTF-8",
            LC_ALL: process.env.LC_ALL || "ru_RU.UTF-8"
        }
    });

    py = childProcess;
    pythonAvailable = true;
    pythonError = null;

    childProcess.on("error", (error: Error) => {
        py = null;
        setUnavailable("Failed to spawn python process", error);
    });

    childProcess.stdout.on("data", (chunk: Buffer) => {
        const lines = chunk.toString("utf-8").split("\n").filter(Boolean);
        for (const line of lines) {
            try {
                const msg = JSON.parse(line);
                handlePythonMessage(msg);
            } catch (e) {
                app?.log?.error?.({ line }, "Invalid JSON from Python");
            }
        }
    });

    childProcess.on("exit", (code: number) => {
        if (code !== 0) {
            setUnavailable(`Python exited with code ${code}`);
        } else {
            pythonAvailable = false;
            pythonInitialized = false;
        }
        app?.log?.warn?.({ code }, "Python exited");
        py = null;
    });
}

function handlePythonMessage(msg: any) {
    if (msg.type === "error") {
        const errorMessage = msg.error || "Unknown Python controller error";
        setUnavailable(errorMessage);
        for (const socket of pythonSubscribers) {
            try {
                if (socket && typeof socket.emit === "function") {
                    socket.emit("voice_result", {
                        type: "voice_error",
                        error: errorMessage
                    });
                }
            } catch (e) {
                app?.log?.error?.("Error sending python error to socket client:", e);
            }
        }
        return;
    }

    if (msg.type === "actions") {
        executeActions(msg.actions, app);
        for (const socket of pythonSubscribers) {
            try {
                // @ts-ignore - socket type from Set<any>
                if (socket && typeof socket.emit === "function") {
                    // @ts-ignore
                    socket.emit("voice_result", {
                        type: "voice_result",
                        actions: msg.actions,
                        error: msg.error
                    });
                }
            } catch (e) {
                app?.log?.error?.("Error sending to socket client:", e);
            }
        }
    }
}

export function sendToPython(obj: any) {
    ensurePython();
    // @ts-ignore - py can be null or ChildProcess
    if (py && py.stdin) {
        // @ts-ignore
        py.stdin.write(JSON.stringify(obj) + "\n");
        return true;
    }
    return false;
}

export async function sendVoiceToPython(socket: any, text: string) {
    if (socket) pythonSubscribers.add(socket);
    const delivered = sendToPython({ type: "voice_command", text });
    if (!delivered && socket && typeof socket.emit === "function") {
        socket.emit("voice_result", {
            type: "voice_error",
            error: pythonError?.message || "Python voice backend is unavailable",
            text
        });
    }
}

export function removePythonSubscriber(socket: any) {
    pythonSubscribers.delete(socket);
}

export function getPythonStatus() {
    return {
        initialized: pythonInitialized,
        available: pythonAvailable,
        error: pythonError?.message || null
    };
}
