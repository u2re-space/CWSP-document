// =========================
// Socket.IO Setup and Handlers
// =========================

import { Server } from "socket.io";
import { registerAirpadSocketHandlers } from "../../airpad/index.ts";
import { applySocketIoPrivateNetworkHeaders, buildSocketIoOptions, describeHandshake, isPrivateNetworkCorsEnabled } from "../socket/socketio-security.ts";

export function setupSocketIO(server: any, logger?: any) {
    const io = new Server(server, buildSocketIoOptions(logger));
    const allowPrivateNetwork = isPrivateNetworkCorsEnabled();
    io.engine.on("initial_headers", (headers, req) => {
        if (allowPrivateNetwork) {
            applySocketIoPrivateNetworkHeaders(headers as any, req);
        }
    });
    io.engine.on("headers", (headers, req) => {
        if (allowPrivateNetwork) {
            applySocketIoPrivateNetworkHeaders(headers as any, req);
        }
    });
    logger?.info?.("[socket.io] Bridge initialized");

    io.engine.on("connection_error", (err: any) => {
        logger?.warn?.(
            {
                code: err?.code,
                message: err?.message,
                context: err?.context
            },
            "[socket.io] Engine connection error"
        );
    });

    io.on("connection", (socket: any) => {
        logger?.info?.(
            {
                socketId: socket?.id,
                transport: socket?.conn?.transport?.name,
                handshake: describeHandshake(socket?.request)
            },
            "[socket.io] Client connected"
        );
        registerAirpadSocketHandlers(socket, {
            logger,
            onDisconnect: (reason) => {
                logger?.info?.(
                    {
                        socketId: socket?.id,
                        reason,
                        transport: socket?.conn?.transport?.name,
                        handshake: describeHandshake(socket?.request)
                    },
                    "[socket.io] Client disconnected"
                );
            }
        });
    });

    io.on("connect_error", (err: any) => {
        logger?.warn?.({ message: err?.message, data: err?.data }, "[socket.io] connect_error");
    });

    return io;
}
