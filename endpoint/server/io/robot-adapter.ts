import { createRequire } from "node:module";
import config from "../config/config.ts";
import { pickEnvBoolLegacy } from "../lib/env.ts";
import { parsePortableBooleanLoose } from "../lib/parsing.ts";

type RobotButton = "left" | "right" | "middle";
type RobotToggleState = "down" | "up";

interface RobotLike {
    getMousePos(): { x: number; y: number };
    moveMouse(x: number, y: number): void;
    mouseClick(button?: RobotButton, double?: boolean): void;
    mouseToggle(state: RobotToggleState, button?: RobotButton): void;
    scrollMouse(dx: number, dy: number): void;
    keyTap(key: string, modifier?: string | string[]): void;
    keyToggle(key: string, state: RobotToggleState): void;
    typeString(text: string): void;
}

const require = createRequire(import.meta.url);

let robotInstance: RobotLike | null = null;
let triedLoading = false;
let warnedUnavailable = false;
const pickConfigFlag = (...candidates: unknown[]): boolean | undefined => {
    for (const item of candidates) {
        const parsed = parsePortableBooleanLoose(item);
        if (typeof parsed === "boolean") return parsed;
    }
    return undefined;
};

const robotJsEnv = pickConfigFlag(pickEnvBoolLegacy("CWS_AIRPAD_ROBOTJS_ENABLED", false), pickEnvBoolLegacy("CWS_ENDPOINT_ROBOTJS_ENABLED", false), pickEnvBoolLegacy("CWS_ROBOTJS_ENABLED", false));
const robotJsConfig = pickConfigFlag((config as any)?.core?.robotJsEnabled, (config as any)?.core?.robotjsEnabled, (config as any)?.airpad?.robotJsEnabled, (config as any)?.airpad?.robotjsEnabled, (config as any)?.robotJsEnabled, (config as any)?.robotjsEnabled, (config as any)?.robotEnabled);
const defaultRobotJsEnabled = process.platform === "win32";
const robotJsEnabled = robotJsEnv ?? robotJsConfig ?? defaultRobotJsEnabled;

function loadRobot(): RobotLike | null {
    if (triedLoading) return robotInstance;
    triedLoading = true;
    if (!robotJsEnabled) {
        robotInstance = null;
        return robotInstance;
    }

    try {
        robotInstance = require("robotjs") as RobotLike;
    } catch (error) {
        robotInstance = null;
        if (!warnedUnavailable) {
            warnedUnavailable = true;
            console.warn("[robot-adapter] robotjs is unavailable; falling back to alternative adapters (AHK if available).", error);
        }
    }

    return robotInstance;
}

export function getRobot(): RobotLike | null {
    return loadRobot();
}

export function hasRobot(): boolean {
    return loadRobot() !== null;
}
