// =========================
// Robot Actions Execution
// =========================

import clipboardy from "clipboardy";
import config from "../config/config.ts";
import { ahkService } from "./ahk-service.ts";
import { getRobot } from "./robot-adapter.ts";
import { pickEnvBoolLegacy } from "../lib/env.ts";
import { parsePortableBooleanLoose } from "../lib/parsing.ts";

let useAHK = false;
let ahkInitialized = false;
let ahkInitPromise: Promise<boolean> | null = null;
const preferAhkMouse = pickEnvBoolLegacy("CWS_ENDPOINT_USE_AHK_MOUSE", false) === true;
let lastActionDriverWarningAt = 0;

const warnNoNativeInputDriver = (reason: string) => {
    const now = Date.now();
    if (now - lastActionDriverWarningAt < 5000) return;
    lastActionDriverWarningAt = now;
    console.warn(`[AirPad actions] No native input driver for this event: ${reason}. Check CWS_AIRPAD_NATIVE_ACTIONS / CWS_AIRPAD_ROBOTJS_ENABLED and AHK availability.`);
};

const pickConfigFlag = (...candidates: unknown[]): boolean | undefined => {
    for (const item of candidates) {
        const parsed = parsePortableBooleanLoose(item);
        if (typeof parsed === "boolean") return parsed;
    }
    return undefined;
};

const nativeActionsEnv = pickConfigFlag(pickEnvBoolLegacy("CWS_AIRPAD_NATIVE_ACTIONS", false), pickEnvBoolLegacy("CWS_ENDPOINT_NATIVE_ACTIONS", false), pickEnvBoolLegacy("CWS_ENDPOINT_ENABLE_NATIVE_ACTIONS", false));
const nativeActionsConfig = pickConfigFlag((config as any)?.core?.nativeActionsEnabled, (config as any)?.core?.airpadNativeActions, (config as any)?.core?.airpad?.nativeActionsEnabled, (config as any)?.airpad?.nativeActionsEnabled, (config as any)?.airpad?.nativeActions, (config as any)?.nativeActionsEnabled, (config as any)?.airpadNativeActions, (config as any)?.nativeActions);
const defaultNativeActionsEnabled = process.platform === "win32";
const nativeActionsEnabled = nativeActionsEnv ?? nativeActionsConfig ?? defaultNativeActionsEnabled;

// Очередь для последовательной обработки символов
interface CharTask {
    charCode: number;
    flags: number;
    resolve: () => void;
    reject: (err: Error) => void;
}

let charQueue: CharTask[] = [];
let isProcessingQueue = false;
let lastKeyboardEvent = { charCode: -1, flags: -1, at: 0 };
const KEYBOARD_DUPLICATE_WINDOW_MS = 20;

// =========================
// AHK Service Management
// =========================

async function initAHKService(): Promise<boolean> {
    if (!nativeActionsEnabled) return false;
    if (ahkInitialized) return useAHK;
    if (ahkInitPromise) return ahkInitPromise;

    ahkInitPromise = (async () => {
        ahkInitialized = true;
        try {
            await ahkService.start();
            useAHK = true;
            console.log("AHK service started successfully");
            return true;
        } catch (err) {
            console.warn("AHK not available, using fallback:", (err as Error).message);
            useAHK = false;
            return false;
        } finally {
            ahkInitPromise = null;
        }
    })();

    return ahkInitPromise;
}

function shutdownAHKService() {
    if (useAHK) {
        ahkService.stop();
        useAHK = false;
    }
}

function ensureAHKInitialized() {
    if (!nativeActionsEnabled) return;
    if (!ahkInitialized) {
        void initAHKService();
        return;
    }

    if (useAHK && !ahkService.isReady()) {
        useAHK = false;
        ahkInitialized = false;
        ahkInitPromise = null;
        console.warn("[AirPad actions] AHK service is not ready. Restarting service...");
        void initAHKService();
    }
}

function canUseAHKMouse(robotAvailable: boolean): boolean {
    if (!nativeActionsEnabled) return false;
    return useAHK && ahkService.isReady() && (preferAhkMouse || !robotAvailable);
}

// =========================
// Mouse Functions
// =========================

function executeMouseMove(dx: number, dy: number) {
    if (!nativeActionsEnabled) return;
    ensureAHKInitialized();
    const robot = getRobot();
    if (canUseAHKMouse(robot != null)) {
        void ahkService.moveMouseBy(dx, dy).catch(() => { });
        return;
    }
    if (!robot) {
        warnNoNativeInputDriver("mouse move (AHK unavailable and robotjs missing)");
        return;
    }
    const pos = robot.getMousePos();
    robot.moveMouse(pos.x + dx, pos.y + dy);
}

function executeMouseClick(button: "left" | "right" | "middle" = "left", double: boolean = false) {
    if (!nativeActionsEnabled) return;
    ensureAHKInitialized();
    const robot = getRobot();
    if (canUseAHKMouse(robot != null)) {
        void ahkService.mouseClick(button, double).catch(() => { });
        return;
    }
    if (!robot) {
        warnNoNativeInputDriver("mouse click (AHK unavailable and robotjs missing)");
        return;
    }
    robot.mouseClick(button, double);
}

function executeMouseToggle(state: "down" | "up", button: "left" | "right" | "middle" = "left") {
    if (!nativeActionsEnabled) return;
    ensureAHKInitialized();
    const robot = getRobot();
    if (canUseAHKMouse(robot != null)) {
        void ahkService.mouseToggle(state, button).catch(() => { });
        return;
    }
    if (!robot) {
        warnNoNativeInputDriver("mouse toggle (AHK unavailable and robotjs missing)");
        return;
    }
    robot.mouseToggle(state, button);
}

// =========================
// Scroll Function
// =========================

function executeScroll(dx: number, dy: number) {
    if (!nativeActionsEnabled) return;
    ensureAHKInitialized();
    const robot = getRobot();
    if (canUseAHKMouse(robot != null)) {
        void ahkService.scrollMouse(dx, dy).catch(() => { });
        return;
    }
    if (!robot) {
        warnNoNativeInputDriver("scroll (AHK unavailable and robotjs missing)");
        return;
    }
    // robotjs scrollMouse(x, y) - positive y scrolls up, negative scrolls down
    robot.scrollMouse(dx, dy);
}

// =========================
// Keyboard Functions
// =========================

// Обработка очереди символов
async function processCharQueue() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;

    while (charQueue.length > 0) {
        const task = charQueue.shift()!;
        try {
            await executeKeyboardCharInternal(task.charCode, task.flags);
            task.resolve();
        } catch (err) {
            task.reject(err as Error);
        }
    }

    isProcessingQueue = false;
}

// Внутренняя функция выполнения
async function executeKeyboardCharInternal(charCode: number, flags: number): Promise<void> {
    if (!nativeActionsEnabled) return;
    // Специальные клавиши
    if (flags === 1) {
        // Backspace
        if (useAHK && ahkService.isReady()) {
            await ahkService.sendKey("{Backspace}");
        } else {
            const robot = getRobot();
            if (!robot) {
                warnNoNativeInputDriver("keyboard backspace (AHK unavailable and robotjs missing)");
                return;
            }
            robot.keyTap("backspace");
        }
        return;
    }

    if (flags === 2) {
        // Enter
        if (useAHK && ahkService.isReady()) {
            await ahkService.sendKey("{Enter}");
        } else {
            const robot = getRobot();
            if (!robot) {
                warnNoNativeInputDriver("keyboard enter (AHK unavailable and robotjs missing)");
                return;
            }
            robot.keyTap("enter");
        }
        return;
    }

    if (flags === 3) {
        // Space
        if (useAHK && ahkService.isReady()) {
            await ahkService.sendText(" ");
        } else {
            const robot = getRobot();
            if (!robot) {
                warnNoNativeInputDriver("keyboard space (AHK unavailable and robotjs missing)");
                return;
            }
            robot.keyTap("space");
        }
        return;
    }

    if (flags === 4) {
        // Tab
        if (useAHK && ahkService.isReady()) {
            await ahkService.sendKey("{Tab}");
        } else {
            const robot = getRobot();
            if (!robot) {
                warnNoNativeInputDriver("keyboard tab (AHK unavailable and robotjs missing)");
                return;
            }
            robot.keyTap("tab");
        }
        return;
    }

    if (charCode <= 0) return;

    try {
        const char = String.fromCodePoint(charCode);

        if (useAHK && ahkService.isReady()) {
            // AHK SendText работает с любыми Unicode символами
            await ahkService.sendText(char);
        } else {
            const robot = getRobot();
            if (!robot) {
                warnNoNativeInputDriver("keyboard char (AHK unavailable and robotjs missing)");
                return;
            }
            // Fallback на robotjs (только ASCII надёжно)
            if (charCode <= 127) {
                robot.typeString(char);
            } else {
                // Для не-ASCII пробуем clipboard paste
                await pasteViaClipboard(char);
            }
        }
    } catch (err) {
        console.error("executeKeyboardChar error:", err);
    }
}

// Fallback вставка через буфер обмена
async function pasteViaClipboard(text: string): Promise<void> {
    if (!nativeActionsEnabled) return;
    const robot = getRobot();
    if (!robot) {
        warnNoNativeInputDriver("paste text (AHK unavailable and robotjs missing)");
        return;
    }

    if (!clipboardy) {
        console.warn("clipboardy not available");
        return;
    }

    try {
        const oldClip = await clipboardy.read().catch(() => "");
        await clipboardy.write(text);
        await new Promise((r) => setTimeout(r, 10));
        robot.keyTap("v", "control");
        await new Promise((r) => setTimeout(r, 30));
        await clipboardy.write(oldClip).catch(() => { });
    } catch (err) {
        console.error("pasteViaClipboard error:", err);
    }
}

// Публичная функция для отправки символа
function executeKeyboardChar(charCode: number, flags: number): Promise<void> {
    if (!nativeActionsEnabled) return Promise.resolve();
    const now = Date.now();
    if (lastKeyboardEvent.charCode === charCode && lastKeyboardEvent.flags === flags && now - lastKeyboardEvent.at < KEYBOARD_DUPLICATE_WINDOW_MS) {
        return Promise.resolve();
    }
    lastKeyboardEvent = { charCode, flags, at: now };

    // Инициализируем AHK при первом вызове
    ensureAHKInitialized();

    // Для простых ASCII и специальных клавиш - быстрый путь
    if (flags > 0 || (charCode > 0 && charCode <= 127 && !useAHK)) {
        return executeKeyboardCharInternal(charCode, flags);
    }

    // Для остального используем очередь
    return new Promise((resolve, reject) => {
        charQueue.push({ charCode, flags, resolve, reject });
        processCharQueue();
    });
}

// Отправка строки целиком (оптимизация для paste)
async function executeKeyboardString(text: string): Promise<void> {
    if (!nativeActionsEnabled) return;
    ensureAHKInitialized();
    if (!ahkInitialized) {
        await initAHKService();
    }

    if (useAHK && ahkService.isReady()) {
        // Для длинных строк используем paste
        if (text.length > 10) {
            await ahkService.pasteText(text);
        } else {
            await ahkService.sendText(text);
        }
    } else {
        // Fallback - посимвольно
        for (const char of text) {
            const codePoint = char.codePointAt(0) || 0;
            await executeKeyboardCharInternal(codePoint, 0);
        }
    }
}

// =========================
// Complex Actions Execution
// =========================

async function executeActions(actions: any[], appLogger?: any) {
    if (!Array.isArray(actions)) return;

    for (const action of actions) {
        if (!nativeActionsEnabled) continue;
        switch (action.action) {
            case "move_mouse": {
                const dx = action.dx || 0;
                const dy = action.dy || 0;
                executeMouseMove(dx, dy);
                break;
            }
            case "click": {
                const button = action.button || "left";
                const double = !!action.double;
                executeMouseClick(button, double);
                break;
            }
            case "mouse_down": {
                const button = action.button || "left";
                executeMouseToggle("down", button);
                break;
            }
            case "mouse_up": {
                const button = action.button || "left";
                executeMouseToggle("up", button);
                break;
            }
            case "scroll": {
                const dx = action.dx || 0;
                const dy = action.dy || 0;
                executeScroll(dx, dy);
                break;
            }
            case "type_text": {
                const text = action.text || "";
                await executeKeyboardString(text);
                break;
            }
            case "key_tap": {
                const key = action.key || "";
                const modifiers = action.modifiers || [];
                const robot = getRobot();
                if (!robot && useAHK && ahkService.isReady()) {
                    void ahkService.sendRawText(key).catch(() => { });
                    break;
                }
                if (!robot) {
                    warnNoNativeInputDriver("key_tap (AHK unavailable and robotjs missing)");
                    break;
                }
                if (modifiers.length > 0) {
                    robot.keyTap(key, modifiers);
                } else {
                    robot.keyTap(key);
                }
                break;
            }
            case "hotkey": {
                const keys = action.keys || [];
                const robot = getRobot();
                if (!robot) {
                    warnNoNativeInputDriver("hotkey action (AHK unavailable and robotjs missing)");
                    break;
                }
                if (keys.length > 0) {
                    // Press all keys down
                    keys.forEach((k: string) => robot.keyToggle(k, "down"));
                    // Release in reverse order
                    keys.slice()
                        .reverse()
                        .forEach((k: string) => robot.keyToggle(k, "up"));
                }
                break;
            }
            default:
                if (appLogger) {
                    appLogger.log.info({ action }, "Unknown action");
                }
                break;
        }
    }
}

// =========================
// Exports
// =========================

export {
    // AHK management
    initAHKService,
    shutdownAHKService,

    // Mouse functions
    executeMouseMove,
    executeMouseClick,
    executeMouseToggle,

    // Scroll function
    executeScroll,

    // Keyboard functions
    executeKeyboardChar,
    executeKeyboardString,

    // Complex actions
    executeActions,

    // Clipboard-style hotkeys
    executeCopyHotkey,
    executeCutHotkey,
    executePasteHotkey
};

// =========================
// Clipboard hotkeys (Ctrl+C / Ctrl+X / Ctrl+V)
// =========================

function executeCopyHotkey() {
    if (!nativeActionsEnabled) return;
    ensureAHKInitialized();
    if (useAHK && ahkService.isReady()) {
        void ahkService.sendKey("^c").catch(() => { });
        return;
    }
    const robot = getRobot();
    if (!robot) {
        warnNoNativeInputDriver("copy hotkey (AHK unavailable and robotjs missing)");
        return;
    }
    robot.keyTap("c", "control");
}

function executeCutHotkey() {
    if (!nativeActionsEnabled) return;
    ensureAHKInitialized();
    if (useAHK && ahkService.isReady()) {
        void ahkService.sendKey("^x").catch(() => { });
        return;
    }
    const robot = getRobot();
    if (!robot) {
        warnNoNativeInputDriver("cut hotkey (AHK unavailable and robotjs missing)");
        return;
    }
    robot.keyTap("x", "control");
}

function executePasteHotkey() {
    if (!nativeActionsEnabled) return;
    ensureAHKInitialized();
    if (useAHK && ahkService.isReady()) {
        void ahkService.sendKey("^v").catch(() => { });
        return;
    }
    const robot = getRobot();
    if (!robot) {
        warnNoNativeInputDriver("paste hotkey (AHK unavailable and robotjs missing)");
        return;
    }
    robot.keyTap("v", "control");
}
