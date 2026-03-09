// =========================
// Binary Message Parsing
// =========================

import { MSG_TYPE_KEYBOARD, BUTTON_LEFT, BUTTON_RIGHT, BUTTON_MIDDLE } from "../config/constants.ts";

// Binary message format (8 bytes)
//
// For KEYBOARD messages (type = 6):
//   Bytes 0-3: codePoint (unsigned int32, little-endian) - full Unicode code point
//   Byte 4: message type (6 = keyboard)
//   Byte 5: flags (0=normal, 1=backspace, 2=enter, 3=space, 4=tab)
//   Bytes 6-7: reserved
//
// For other messages (mouse, scroll, etc.):
//   Bytes 0-1: dx (signed int16, little-endian)
//   Bytes 2-3: dy (signed int16, little-endian)
//   Byte 4: message type (0=move, 1=click, 2=scroll, 3=mouse_down, 4=mouse_up, 5=voice_command)
//   Byte 5: button/flags (for click/mouse: 0=left, 1=right, 2=middle, 0x80=double)
//   Bytes 6-7: reserved

interface KeyboardMessage {
    type: number;
    codePoint: number;
    flags: number;
}

interface MouseMessage {
    type: number;
    dx: number;
    dy: number;
    flags: number;
}

type ParsedMessage = KeyboardMessage | MouseMessage | null;

export function parseBinaryMessage(buffer: Buffer | Uint8Array | ArrayBuffer): ParsedMessage {
    // Handle both Buffer (Node.js) and Uint8Array (browser)
    let buf: Buffer;
    if (Buffer.isBuffer(buffer)) {
        buf = buffer;
    } else if (buffer instanceof Uint8Array) {
        buf = Buffer.from(buffer);
    } else if (buffer instanceof ArrayBuffer) {
        buf = Buffer.from(new Uint8Array(buffer));
    } else {
        return null;
    }

    if (buf.length < 6) {
        return null;
    }

    const type = buf[4];

    // For keyboard messages, first 4 bytes are full Unicode code point
    if (type === MSG_TYPE_KEYBOARD) {
        const codePoint = buf.readUInt32LE(0); // Full Unicode code point (0 - 0x10FFFF)
        const flags = buf[5];

        return {
            type,
            codePoint,
            flags
        };
    }

    // For other messages, dx/dy are signed int16
    const dx = buf.readInt16LE(0);
    const dy = buf.readInt16LE(2);
    const flags = buf[5];

    return {
        type,
        dx,
        dy,
        flags
    };
}

export function buttonFromFlags(flags: number): "left" | "right" | "middle" {
    const buttonNum = flags & 0x7f;
    switch (buttonNum) {
        case BUTTON_LEFT:
            return "left";
        case BUTTON_RIGHT:
            return "right";
        case BUTTON_MIDDLE:
            return "middle";
        default:
            return "left";
    }
}

// Helper to check if message is keyboard type
export function isKeyboardMessage(msg: ParsedMessage): msg is KeyboardMessage {
    return msg !== null && msg.type === MSG_TYPE_KEYBOARD;
}

// Helper to check if message is mouse type
export function isMouseMessage(msg: ParsedMessage): msg is MouseMessage {
    return msg !== null && msg.type !== MSG_TYPE_KEYBOARD && "dx" in msg;
}
