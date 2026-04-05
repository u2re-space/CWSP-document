export type AirPadPointerButton = "left" | "right" | "middle";

export type AirPadIntent =
    | {
        type: "pointer.move";
        dx: number;
        dy: number;
        dz?: number;
    }
    | {
        type: "pointer.click";
        button?: AirPadPointerButton;
        double?: boolean;
        count?: number;
    }
    | {
        type: "pointer.scroll";
        dx?: number;
        dy?: number;
    }
    | {
        type: "pointer.down";
        button?: AirPadPointerButton;
    }
    | {
        type: "pointer.up";
        button?: AirPadPointerButton;
    }
    | {
        type: "gesture.swipe";
        direction: "up" | "down" | "left" | "right";
    }
    | {
        type: "voice.submit";
        text: string;
    }
    | {
        type: "keyboard.char";
        char: string;
    }
    | {
        type: "keyboard.binary";
        codePoint: number;
        flags?: number;
    };

export type AirPadClipboardResult = {
    ok: boolean;
    text?: string;
    error?: string;
};
