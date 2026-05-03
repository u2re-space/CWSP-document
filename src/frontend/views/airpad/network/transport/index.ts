import {
    connectPacketWsRail,
    createPacketWsKeyboardMessage,
    disconnectPacketWsRail,
    initPacketWsRail,
    isPacketWsRailConnected,
    onPacketWsClipboardUpdate,
    onPacketWsRailConnectionChange,
    requestPacketWsClipboardCopy,
    requestPacketWsClipboardCut,
    requestPacketWsClipboardPaste,
    requestPacketWsClipboardRead,
    sendPacketWsBinary,
    sendPacketWsIntent
} from "../rails/packet-ws";
import { onVoiceResult } from "shared/transport/websocket";

export const airpadTransport = {
    init: initPacketWsRail,
    connect: connectPacketWsRail,
    disconnect: disconnectPacketWsRail,
    isConnected: isPacketWsRailConnected,
    onConnectionChange: onPacketWsRailConnectionChange,
    onClipboardUpdate: onPacketWsClipboardUpdate,
    onVoiceResult,
    sendIntent: sendPacketWsIntent,
    sendBinary: sendPacketWsBinary,
    createKeyboardMessage: createPacketWsKeyboardMessage,
    requestClipboardRead: requestPacketWsClipboardRead,
    requestClipboardCopy: requestPacketWsClipboardCopy,
    requestClipboardCut: requestPacketWsClipboardCut,
    requestClipboardPaste: requestPacketWsClipboardPaste
};
