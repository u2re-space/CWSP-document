// Temporary compatibility shim. New code should import `packet-socketio.ts`.
export {
    connectPacketSocketIoRail as connectLegacySocketIoRail,
    createPacketSocketIoKeyboardMessage as createLegacySocketIoKeyboardMessage,
    disconnectPacketSocketIoRail as disconnectLegacySocketIoRail,
    initPacketSocketIoRail as initLegacySocketIoRail,
    isPacketSocketIoRailConnected as isLegacySocketIoRailConnected,
    onPacketSocketIoClipboardUpdate as onLegacySocketIoClipboardUpdate,
    onPacketSocketIoRailConnectionChange as onLegacySocketIoRailConnectionChange,
    requestPacketSocketIoClipboardCopy as requestLegacySocketIoClipboardCopy,
    requestPacketSocketIoClipboardCut as requestLegacySocketIoClipboardCut,
    requestPacketSocketIoClipboardPaste as requestLegacySocketIoClipboardPaste,
    requestPacketSocketIoClipboardRead as requestLegacySocketIoClipboardRead,
    sendPacketSocketIoBinary as sendLegacySocketIoBinary,
    sendPacketSocketIoIntent as sendLegacySocketIoIntent
} from "./packet-socketio";
