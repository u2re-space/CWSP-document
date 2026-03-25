import {
    connectPacketSocketIoRail,
    createPacketSocketIoKeyboardMessage,
    disconnectPacketSocketIoRail,
    initPacketSocketIoRail,
    isPacketSocketIoRailConnected,
    onPacketSocketIoClipboardUpdate,
    onPacketSocketIoRailConnectionChange,
    requestPacketSocketIoClipboardCopy,
    requestPacketSocketIoClipboardCut,
    requestPacketSocketIoClipboardPaste,
    requestPacketSocketIoClipboardRead,
    sendPacketSocketIoBinary,
    sendPacketSocketIoIntent
} from "../rails/packet-socketio";
import { onVoiceResult } from "../websocket";

export const airpadTransport = {
    init: initPacketSocketIoRail,
    connect: connectPacketSocketIoRail,
    disconnect: disconnectPacketSocketIoRail,
    isConnected: isPacketSocketIoRailConnected,
    onConnectionChange: onPacketSocketIoRailConnectionChange,
    onClipboardUpdate: onPacketSocketIoClipboardUpdate,
    onVoiceResult,
    sendIntent: sendPacketSocketIoIntent,
    sendBinary: sendPacketSocketIoBinary,
    createKeyboardMessage: createPacketSocketIoKeyboardMessage,
    requestClipboardRead: requestPacketSocketIoClipboardRead,
    requestClipboardCopy: requestPacketSocketIoClipboardCopy,
    requestClipboardCut: requestPacketSocketIoClipboardCut,
    requestClipboardPaste: requestPacketSocketIoClipboardPaste
};
