export { registerAirpadSocketHandlers } from "./socket-airpad.ts";
export { createAirpadRouter, type AirpadSocketRouter, type AirpadRouterDebugDevice } from "./router.ts";
export {
    describeAirPadConnectionMeta,
    isAirPadAuthorized,
    requiresAirpadMessageAuth,
    getAirPadTokens,
    isAirPadRequestAuthorized,
    isAirPadMessageAuthRequired,
    createAirpadObjectMessageHandler
} from "./airpad.ts";
export type {
    AirpadClipHistoryEntry,
    AirpadConnectionMeta
} from "./airpad.ts";
export { handleKeyboardBinaryAction } from "./input/keyboard.ts";
export { handleMouseBinaryAction } from "./input/mouse.ts";
export { emitClipboardUpdateToSockets, readAirpadClipboard, writeAirpadClipboard } from "./input/clipboard.ts";
export { ahkService } from "./input/ahk.ts";
export { getRobot } from "./input/robot.ts";
