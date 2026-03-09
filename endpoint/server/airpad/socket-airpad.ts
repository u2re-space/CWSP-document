import type { Socket } from "socket.io";

import { parseBinaryMessage } from "../io/message.ts";
import { executeCopyHotkey, executeCutHotkey, executePasteHotkey } from "../io/actions.ts";
import { sendVoiceToPython, removePythonSubscriber } from "../gpt/python.ts";
import { safeJsonParse } from "../lib/parsing.ts";
import { handleKeyboardBinaryAction } from "./input/keyboard.ts";
import { handleMouseBinaryAction } from "./input/mouse.ts";
import { emitClipboardUpdateToSockets, readAirpadClipboard, writeAirpadClipboard } from "./input/clipboard.ts";

type AirpadObjectMessageHandler = (msg: any, socket: Socket) => void | Promise<void>;
type AirpadDisconnectHandler = (reason: string, socket: Socket) => void | Promise<void>;
type AirpadBinaryMessageHandler = (data: Buffer | Uint8Array | ArrayBuffer, socket: Socket) => boolean | Promise<boolean>;
type AirpadClipboardSource = "local" | "network";

export interface AirpadSocketHandlerOptions {
    logger?: any;
    onObjectMessage?: AirpadObjectMessageHandler;
    onBinaryMessage?: AirpadBinaryMessageHandler;
    allowLocalInput?: boolean;
    onDisconnect?: AirpadDisconnectHandler;
}

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

const airpadSockets = new Set<Socket>();

function emitClipboardUpdate(text: string, source: AirpadClipboardSource): void {
    emitClipboardUpdateToSockets(airpadSockets, text, source);
}

function handleAirpadBinaryMessage(logger: any, buffer: Buffer | Uint8Array | ArrayBuffer): boolean {
    const msg = parseBinaryMessage(buffer);
    if (!msg) {
        logger?.warn?.("Invalid binary message format");
        return false;
    }

    const handledByMouse = handleMouseBinaryAction(logger, msg);
    const handledByKeyboard = handleKeyboardBinaryAction(logger, msg);
    if (!handledByMouse && !handledByKeyboard && msg?.type) {
        logger?.info?.({ type: msg.type }, "Unknown binary message type");
        return false;
    }
    return handledByMouse || handledByKeyboard;
}

export function registerAirpadSocketHandlers(socket: Socket, options: AirpadSocketHandlerOptions = {}): void {
    const { logger, onObjectMessage, onBinaryMessage, onDisconnect, allowLocalInput = true } = options;
    airpadSockets.add(socket);

    readAirpadClipboard()
        .then((text) => socket.emit("clipboard:update", { text, source: "local" }))
        .catch(() => { });

    socket.on("message", async (data: any) => {
        if (Buffer.isBuffer(data) || data instanceof Uint8Array || data instanceof ArrayBuffer) {
            const localHandled = allowLocalInput ? handleAirpadBinaryMessage(logger, data) : false;
            const routed = await onBinaryMessage?.(data as any, socket);
            if (routed && localHandled) {
                logger?.debug?.(
                    { socketId: socket.id, localHandled, routed },
                    "[airpad] binary both executed locally and routed (possible bridge fan-out)"
                );
            }
            if (allowLocalInput && !localHandled && routed) {
                logger?.warn?.(
                    { socketId: socket.id },
                    "[airpad] binary routed but not parsed locally"
                );
            }
            return;
        }

        if (typeof data === "string") {
            const jsonData = safeJsonParse<Record<string, unknown>>(data);
            if (jsonData && typeof jsonData === "object") {
                if (jsonData?.type === "voice_command") {
                    if (!allowLocalInput) {
                        await onObjectMessage?.(jsonData, socket);
                        return;
                    }
                    const text = String(jsonData.text || "");
                    logger?.info?.("Voice command");
                    await sendVoiceToPython(socket as any, text).catch((err: any) => {
                        logger?.error?.({ err }, "Failed to send voice command to python");
                        socket.emit("voice_result", {
                            type: "voice_error",
                            error: err?.message || String(err),
                        });
                    });
                    return;
                }
                await onObjectMessage?.(jsonData, socket);
                return;
            }

            if (!allowLocalInput) {
                return;
            }
            if (jsonData?.type === "voice_command") {
                const text = String(jsonData.text || "");
                logger?.info?.("Voice command");
                await sendVoiceToPython(socket as any, text).catch((err: any) => {
                    logger?.error?.({ err }, "Failed to send voice command to python");
                    socket.emit("voice_result", {
                        type: "voice_error",
                        error: err?.message || String(err),
                    });
                });
                return;
            }
            return;
        }

        if (data && typeof data === "object") {
            await onObjectMessage?.(data, socket);
        }
    });

    socket.on("clipboard:get", async (ack?: any) => {
        if (!allowLocalInput) {
            if (typeof ack === "function") {
                ack({ ok: false, error: "routing-disabled" });
            }
            return;
        }
        try {
            const text = await readAirpadClipboard();
            const payload = { ok: true, text };
            if (typeof ack === "function") ack(payload);
            socket.emit("clipboard:update", { text, source: "local" });
        } catch (err: any) {
            if (typeof ack === "function") ack({ ok: false, error: err?.message || String(err) });
        }
    });

    socket.on("clipboard:copy", async (ack?: any) => {
        if (!allowLocalInput) {
            if (typeof ack === "function") {
                ack({ ok: false, error: "routing-disabled" });
            }
            return;
        }
        try {
            executeCopyHotkey();
            await sleep(60);
            const text = await readAirpadClipboard();
            const payload = { ok: true, text };
            if (typeof ack === "function") ack(payload);
            emitClipboardUpdate(text, "local");
        } catch (err: any) {
            if (typeof ack === "function") ack({ ok: false, error: err?.message || String(err) });
        }
    });

    socket.on("clipboard:cut", async (ack?: any) => {
        if (!allowLocalInput) {
            if (typeof ack === "function") {
                ack({ ok: false, error: "routing-disabled" });
            }
            return;
        }
        try {
            executeCutHotkey();
            await sleep(60);
            const text = await readAirpadClipboard();
            const payload = { ok: true, text };
            if (typeof ack === "function") ack(payload);
            emitClipboardUpdate(text, "local");
        } catch (err: any) {
            if (typeof ack === "function") ack({ ok: false, error: err?.message || String(err) });
        }
    });

    socket.on("clipboard:paste", async (data: any, ack?: any) => {
        if (!allowLocalInput) {
            if (typeof ack === "function") {
                ack({ ok: false, error: "routing-disabled" });
            }
            return;
        }
        try {
            const text = typeof data?.text === "string" ? data.text : "";
            if (text) {
                await writeAirpadClipboard(text);
                emitClipboardUpdate(text, "local");
                await sleep(20);
            }
            executePasteHotkey();
            if (typeof ack === "function") ack({ ok: true });
        } catch (err: any) {
            if (typeof ack === "function") ack({ ok: false, error: err?.message || String(err) });
        }
    });

    socket.on("disconnect", async (reason: string) => {
        removePythonSubscriber(socket as any);
        airpadSockets.delete(socket);
        await onDisconnect?.(reason, socket);
    });
}