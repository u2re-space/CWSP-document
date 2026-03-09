import type { Socket } from "socket.io";

import { parseBinaryMessage, buttonFromFlags } from "../io/message.ts";
import {
    MSG_TYPE_MOVE,
    MSG_TYPE_CLICK,
    MSG_TYPE_SCROLL,
    MSG_TYPE_MOUSE_DOWN,
    MSG_TYPE_MOUSE_UP,
    MSG_TYPE_KEYBOARD,
    FLAG_DOUBLE,
    SERVER_JITTER_EPS,
} from "../config/constants.ts";
import { addMouseDelta } from "../io/mouse.ts";
import {
    executeMouseClick,
    executeMouseToggle,
    executeScroll,
    executeKeyboardChar,
    executeCopyHotkey,
    executeCutHotkey,
    executePasteHotkey,
} from "../io/actions.ts";
import { sendVoiceToPython, removePythonSubscriber } from "../gpt/python.ts";
import clipboardy from "clipboardy";
import { pickEnvBoolLegacy } from "../lib/env.ts";
import { safeJsonParse } from "../lib/parsing.ts";

type AirpadObjectMessageHandler = (msg: any, socket: Socket) => void | Promise<void>;
type AirpadDisconnectHandler = (reason: string, socket: Socket) => void | Promise<void>;
type AirpadBinaryMessageHandler = (data: Buffer | Uint8Array | ArrayBuffer, socket: Socket) => boolean | Promise<boolean>;
type AirpadClipboardSource = "local" | "network";
const airpadClipboardEnabled =
    pickEnvBoolLegacy("CWS_AIRPAD_CLIPBOARD_ENABLED", true) ??
    pickEnvBoolLegacy("CWS_CLIPBOARD_ENABLED", true) ??
    true;

export interface AirpadSocketHandlerOptions {
    logger?: any;
    onObjectMessage?: AirpadObjectMessageHandler;
    onBinaryMessage?: AirpadBinaryMessageHandler;
    onDisconnect?: AirpadDisconnectHandler;
}

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

const airpadSockets = new Set<Socket>();

function emitClipboardUpdate(text: string, source: AirpadClipboardSource): void {
    const payload = { text, source };
    for (const client of airpadSockets) {
        if (!client || client.disconnected) continue;
        client.emit("clipboard:update", payload);
    }
}

async function readAirpadClipboard(): Promise<string> {
    if (!airpadClipboardEnabled) return "";
    try {
        const text = await clipboardy.read();
        return String(text ?? "");
    } catch (_err) {
        return "";
    }
}

async function writeAirpadClipboard(text: string): Promise<void> {
    if (!airpadClipboardEnabled) return;
    const value = String(text ?? "");
    if (!value) return;
    try {
        await clipboardy.write(value);
    } catch (_err) {
        return;
    }
}

export const tryDecodeBridgeBinary = (raw: unknown): Buffer | null => {
    if (!raw || typeof raw !== "object") return null;
    const candidates: Array<unknown> = [raw];
    const envelopePayload = (raw as any).payload;
    const envelopeData = (raw as any).data;
    if (envelopePayload !== undefined) candidates.push(envelopePayload);
    if (envelopeData !== undefined) candidates.push(envelopeData);

    for (const item of candidates) {
        if (!item || typeof item !== "object") continue;
        const payload: Record<string, unknown> = item as Record<string, unknown>;
        if (payload.__airpadBinary !== true) continue;
        if (payload.encoding && typeof payload.encoding === "string" && payload.encoding.toLowerCase() !== "base64") continue;
        const source = typeof payload.data === "string" ? payload.data : "";
        if (!source) continue;
        try {
            return Buffer.from(source, "base64");
        } catch {
            return null;
        }
    }

    return null;
};

export function handleAirpadBinaryMessage(logger: any, buffer: Buffer | Uint8Array | ArrayBuffer): boolean {
    const msg = parseBinaryMessage(buffer);
    if (!msg) {
        logger?.warn?.("Invalid binary message format");
        return false;
    }

    switch (msg.type) {
        case MSG_TYPE_MOVE: {
            if (!("dx" in msg) || !("dy" in msg)) break;
            const { dx = 0, dy = 0 } = msg;
            if (Math.abs(dx) < SERVER_JITTER_EPS && Math.abs(dy) < SERVER_JITTER_EPS) break;
            addMouseDelta(dx, dy);
            break;
        }
        case MSG_TYPE_CLICK: {
            const button = buttonFromFlags(msg.flags);
            const double = !!(msg.flags & FLAG_DOUBLE);
            executeMouseClick(button, double);
            break;
        }
        case MSG_TYPE_SCROLL: {
            if (!("dx" in msg) || !("dy" in msg)) break;
            executeScroll(msg.dx || 0, msg.dy || 0);
            break;
        }
        case MSG_TYPE_MOUSE_DOWN: {
            executeMouseToggle("down", buttonFromFlags(msg.flags));
            break;
        }
        case MSG_TYPE_MOUSE_UP: {
            executeMouseToggle("up", buttonFromFlags(msg.flags));
            break;
        }
        case MSG_TYPE_KEYBOARD: {
            if (!("codePoint" in msg)) break;
            executeKeyboardChar(msg.codePoint || 0, msg.flags || 0);
            break;
        }
        default:
            logger?.info?.({ type: msg.type }, "Unknown binary message type");
    }

    return true;
}

const normalizeSocketIdentifier = (value: unknown): string => {
    if (!value) return "";
    if (typeof value !== "string") return "";
    return value.trim().toLowerCase();
};

const shouldSkipLocalBinaryExecution = (socket: Socket): boolean => {
    const query: Record<string, unknown> = (socket as any).handshake?.query || {};
    const queryRouteTarget = normalizeSocketIdentifier(
        query.__airpad_route ||
            query.__airpad_route_target ||
            query.routeTarget ||
            query.__airpad_peer ||
            query.__airpad_device ||
            query.__airpad_client ||
            query.target ||
            query.targetId ||
            query.deviceId ||
            query.to ||
            query.peerId
    );
    if (!queryRouteTarget || queryRouteTarget === "self") return false;

    const via = normalizeSocketIdentifier(query.__airpad_via || query.via);
    if (via === "tunnel" || via === "remote") {
        return true;
    }

    const normalizeRouteAlias = (value: string): string[] => {
        const normalized = normalizeSocketIdentifier(value);
        if (!normalized) return [];
        if (normalized.startsWith("l-")) return [normalized, normalized.slice(2)];
        return [normalized, `l-${normalized}`];
    };

    const targetHost = normalizeSocketIdentifier(query.__airpad_target || query.__airpad_host || query.host || query.__airpad_hop);
    if (targetHost) {
        const targetVariants = new Set(normalizeRouteAlias(queryRouteTarget));
        const hostVariants = new Set(normalizeRouteAlias(targetHost));
        for (const targetVariant of targetVariants) {
            if (hostVariants.has(targetVariant)) return false;
        }
    }

    const sourceId = normalizeSocketIdentifier(
        query.__airpad_src ||
        query.__airpad_source ||
        query.source ||
        query.sourceId ||
        query.clientId ||
        query.peerId ||
        query.sourceId
    );
    if (!sourceId) return false;
    return queryRouteTarget !== sourceId;
};

export function registerAirpadSocketHandlers(socket: Socket, options: AirpadSocketHandlerOptions = {}): void {
    const { logger, onObjectMessage, onBinaryMessage, onDisconnect } = options;
    airpadSockets.add(socket);
    const skipLocalBinary = shouldSkipLocalBinaryExecution(socket);

    readAirpadClipboard()
        .then((text) => socket.emit("clipboard:update", { text, source: "local" }))
        .catch(() => { });

    socket.on("message", async (data: any) => {
        if (Buffer.isBuffer(data) || data instanceof Uint8Array || data instanceof ArrayBuffer) {
            const localHandled = skipLocalBinary ? false : handleAirpadBinaryMessage(logger, data);
            const routed = await onBinaryMessage?.(data as any, socket);
            if (skipLocalBinary && localHandled === false && routed) {
                logger?.debug?.(
                    { socketId: socket.id },
                    "[airpad] remote route detected, skipping local binary execution"
                );
            }
            if (routed && localHandled) {
                logger?.debug?.(
                    { socketId: socket.id, localHandled, routed },
                    "[airpad] binary both executed locally and routed (possible bridge fan-out)"
                );
            }
            if (!localHandled && routed) {
                logger?.warn?.(
                    { socketId: socket.id },
                    "[airpad] binary routed but not parsed locally"
                );
            }
            return;
        }

        const bridgeBinary = tryDecodeBridgeBinary(data);
        if (bridgeBinary) {
            const localHandled = handleAirpadBinaryMessage(logger, bridgeBinary);
            if (!localHandled) {
                logger?.warn?.(
                    { socketId: socket.id },
                    "[airpad] bridge binary envelope parsed but message is invalid"
                );
            }
            return;
        }

        if (typeof data === "string") {
            const jsonData = safeJsonParse<Record<string, unknown>>(data);
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
