import { addMouseDelta } from "../../io/mouse.ts";
import { executeMouseClick, executeMouseToggle, executeScroll } from "../../io/actions.ts";
import { MSG_TYPE_CLICK, MSG_TYPE_MOUSE_DOWN, MSG_TYPE_MOUSE_UP, MSG_TYPE_MOVE, MSG_TYPE_SCROLL, FLAG_DOUBLE, SERVER_JITTER_EPS } from "../../config/constants.ts";
import { buttonFromFlags } from "../../io/message.ts";

type MouseAction = {
    type: number;
    dx?: number;
    dy?: number;
    flags?: number;
};

export const handleMouseBinaryAction = (logger: any, msg: MouseAction): boolean => {
    switch (msg.type) {
        case MSG_TYPE_MOVE: {
            if (!("dx" in msg) || !("dy" in msg)) break;
            const { dx = 0, dy = 0 } = msg;
            if (Math.abs(dx) < SERVER_JITTER_EPS && Math.abs(dy) < SERVER_JITTER_EPS) break;
            addMouseDelta(dx, dy);
            return true;
        }
        case MSG_TYPE_CLICK: {
            const button = buttonFromFlags(msg.flags);
            const double = !!(msg.flags && (msg.flags & FLAG_DOUBLE));
            executeMouseClick(button, double);
            return true;
        }
        case MSG_TYPE_SCROLL: {
            if (!("dx" in msg) || !("dy" in msg)) break;
            executeScroll(msg.dx || 0, msg.dy || 0);
            return true;
        }
        case MSG_TYPE_MOUSE_DOWN: {
            executeMouseToggle("down", buttonFromFlags(msg.flags));
            return true;
        }
        case MSG_TYPE_MOUSE_UP: {
            executeMouseToggle("up", buttonFromFlags(msg.flags));
            return true;
        }
        default:
            return false;
    }

    logger?.info?.({ type: msg.type }, "Unknown mouse binary message type");
    return false;
};
