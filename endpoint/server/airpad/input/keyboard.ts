import { executeKeyboardChar } from "../../io/actions.ts";
import { MSG_TYPE_KEYBOARD } from "../../config/constants.ts";

type KeyboardAction = {
    type: number;
    codePoint?: number;
    flags?: number;
};

export const handleKeyboardBinaryAction = (_logger: any, msg: KeyboardAction): boolean => {
    if (msg.type !== MSG_TYPE_KEYBOARD) return false;
    if (!("codePoint" in msg)) return false;
    executeKeyboardChar(msg.codePoint || 0, msg.flags || 0);
    return true;
};
