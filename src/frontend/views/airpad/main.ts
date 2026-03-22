// =========================
// Main entry point
// =========================

//
import stylesheet from "./main.scss?inline";
import { initServiceWorker } from "@rs-frontend/pwa/sw-handling";

//
import { log, getBtnConnect, getAirpadDomRoot, queryAirpad, setAirpadDomRoot } from "./utils/utils";
import { initAirPadSessionTransport, onAirPadSessionConnectionChange } from "./network/session";
import { initSpeechRecognition, initAiButton } from "./input/speech";
import { initAirButton } from "./ui/air-button";
import { initRelativeOrientation } from "./input/sensor/relative-orientation";
import { stopRelativeOrientation } from "./input/sensor/relative-orientation";
import { initVirtualKeyboard, setRemoteKeyboardEnabled } from "./input/virtual-keyboard";
import { initClipboardToolbar } from "./ui/clipboard-toolbar";
import { showConfigUI, teardownAirpadConfigOverlay } from "./ui/config-ui";
import { resetClipboardToolbarState } from "./ui/clipboard-toolbar";
import { loadAsAdopted } from "fest/dom";
import { H } from "fest/lure";
import { waitForDomPaint } from "@rs-frontend/shared/event-handling-policy";
import { resetMotionAccum } from "./config/motion-state";
import { resetMotionBaseline } from "./ui/air-button";
import { resetRelativeOrientationRuntimeState } from "./input/sensor/relative-orientation";
import { reloadAirpadRemoteConfigFromStorage, attachAirpadCrossTabConfigSync } from "./config/config";

let unsubscribeWsKeyboardSync: (() => void) | null = null;
let airpadInitToken = 0;
let airpadInitAbort: AbortController | null = null;
let airpadCrossTabUnsub: (() => void) | null = null;

export function unmountAirpadRuntime(): void {
    airpadInitToken += 1;
    airpadInitAbort?.abort();
    airpadInitAbort = null;
    airpadCrossTabUnsub?.();
    airpadCrossTabUnsub = null;
    unsubscribeWsKeyboardSync?.();
    unsubscribeWsKeyboardSync = null;
    resetClipboardToolbarState();
    teardownAirpadConfigOverlay();
    setAirpadDomRoot(null);
    setRemoteKeyboardEnabled(false);
    stopRelativeOrientation();
}

// =========================
// Mount function for routing system
// =========================

export default async function mountAirpad(mountElement: HTMLElement): Promise<void> {
    console.log("[Airpad] Mounting airpad app...");
    airpadInitToken += 1;
    airpadInitAbort?.abort();
    const initController = new AbortController();
    airpadInitAbort = initController;
    /** Stable for this mount — do not read `airpadInitAbort.signal` after `await`: unmount may set `airpadInitAbort` to null. */
    const initSignal = initController.signal;
    const currentInitToken = airpadInitToken;

    loadAsAdopted(stylesheet);

    // Find or create #app container
    let appContainer = mountElement ?? document.body.querySelector("#app") ?? (document.body as HTMLElement);
    if (!appContainer) {
        appContainer = document.createElement("div");
        appContainer.id = "app";
    }

    // Replace previous airpad markup to avoid duplicate UI when remounting.
    appContainer.replaceChildren(H`
        <div class="container">
            <header class="hero">
                <div class="status-container">
                    <div class="status-bar">
                        <div class="status-item">
                            WS:
                            <span id="wsStatus" class="value ws-status-bad">disconnected</span>
                        </div>
                        <div class="status-item">
                            Air:
                            <span id="airStatus" class="value">IDLE</span>
                        </div>
                        <div class="status-item">
                            AI:
                            <span id="aiStatus" class="value">idle</span>
                        </div>
                        <div class="status-item">
                            VK:
                            <span id="vkStatus" class="value">overlay:off</span>
                        </div>
                    </div>
                </div>
            </header>

            <div class="stage">
                <div class="ai-block">
                    <div id="aiButton" name="airpad-ai" class="big-button ai" data-no-virtual-keyboard="true">
                        AI
                    </div>
                    <div class="label">Голосовой ассистент (удерживай для записи)</div>
                </div>

                <div class="air-block">
                    <div class="air-row">
                    <button type="button" id="airButton" name="airpad-air" class="big-button air" data-no-virtual-keyboard="true">
                        Air
                    </button>
                    <button type="button" id="airNeighborButton" name="airpad-neighbor-act" data-no-virtual-keyboard="true"
                        class="neighbor-button">Act</button>
                    </div>
                    <div class="label">Air‑трекбол/курсор и жесты</div>
                </div>
            </div>
            <div id="voiceText" class="voice-line"></div>
        </div>

        <div class="side-actions-row" role="group" aria-label="Panels">
            <button type="button" id="hintToggle" name="airpad-hints-toggle" class="side-log-toggle side-hint-toggle"
                aria-controls="hintOverlay" aria-expanded="false">
                Hints
            </button>
            <button type="button" id="logToggle" name="airpad-log-toggle" class="side-log-toggle"
                aria-controls="logOverlay" aria-expanded="false">
                Логи
            </button>
            <button type="button" id="btnMotionReset" name="airpad-motion-reset" class="side-log-toggle side-fix-toggle"
                aria-label="Reset motion calibration">
                Fix
            </button>
            <button type="button" id="btnReload" name="airpad-reload" class="side-log-toggle side-reload-toggle"
                aria-label="Reload">
                Reload
            </button>
        </div>

        <div id="logOverlay" class="log-overlay" aria-hidden="true">
            <div class="log-panel">
                <div class="log-overlay-header">
                    <span>Журнал соединения</span>
                    <button type="button" id="logClose" name="airpad-log-close" class="ghost-btn" aria-label="Закрыть логи">Закрыть</button>
                </div>
                <div id="logContainer" class="log-container"></div>
            </div>
        </div>

        <div id="hintOverlay" class="log-overlay hint-overlay" aria-hidden="true">
            <div class="log-panel hint-panel">
                <div class="log-overlay-header">
                    <span>Подсказки AirPad</span>
                    <button type="button" id="hintClose" name="airpad-hint-close" class="ghost-btn" aria-label="Закрыть подсказки">Закрыть</button>
                </div>
                <section class="hint hint-modal-content" id="hintPanel" aria-label="Airpad quick help">
                    <details class="hint-group" data-hint-group>
                        <summary>Жесты Air-кнопки</summary>
                        <ul>
                            <li>Короткий тап — клик.</li>
                            <li>Удержание &gt; 100ms — режим air-мыши.</li>
                            <li>Свайп вверх/вниз по кнопке — скролл.</li>
                            <li>Свайп влево/вправо — жест.</li>
                        </ul>
                    </details>

                    <details class="hint-group" data-hint-group>
                        <summary>AI-кнопка</summary>
                        <ul>
                            <li>Нажми и держи — идёт распознавание речи.</li>
                            <li>Отпусти — команда уйдёт в endpoint voice pipeline.</li>
                        </ul>
                    </details>

                    <details class="hint-group" data-hint-group>
                        <summary>Виртуальная клавиатура</summary>
                        <ul>
                            <li>Открой кнопкой ⌨️ на нижней панели.</li>
                            <li>Поддерживает текст, эмодзи и спецсимволы.</li>
                            <li>Передаёт ввод в бинарном формате.</li>
                        </ul>
                    </details>
                </section>
            </div>
        </div>

        <!-- Bottom clipboard toolbar (phone <-> PC) -->
        <div class="bottom-toolbar" id="clipboardToolbar" aria-label="Clipboard actions">
            <button type="button" id="btnCut" name="airpad-clipboard-cut" class="toolbar-btn" aria-label="Cut (Ctrl+X)">✂️</button>
            <button type="button" id="btnCopy" name="airpad-clipboard-copy" class="toolbar-btn" aria-label="Copy (Ctrl+C)">📋</button>
            <button type="button" id="btnPaste" name="airpad-clipboard-paste" class="toolbar-btn" aria-label="Paste (Ctrl+V)">📥</button>
            <button type="button" id="btnConnect" name="airpad-ws-connect" class="toolbar-btn connect-fab connect-fab--ws">WS ↔</button>
            <button type="button" id="btnConfig" name="airpad-config" class="toolbar-btn" aria-label="Configuration" title="Configuration">⚙️</button>
        </div>
        <div id="clipboardPreview" class="clipboard-preview" aria-live="polite"></div>
    `);

    setAirpadDomRoot(appContainer);

    // Let the browser apply layout / composed tree before scoped queries and addEventListener.
    await waitForDomPaint();
    if (initSignal.aborted || currentInitToken !== airpadInitToken) {
        if (getAirpadDomRoot() === appContainer) {
            setAirpadDomRoot(null);
        }
        return;
    }

    await initAirpadApp(currentInitToken, initSignal, appContainer);
}

// =========================
// Internal initialization
// =========================

async function initAirpadApp(initToken: number | undefined, signal: AbortSignal, domMountRoot?: HTMLElement): Promise<void> {
    const root = domMountRoot;
    if (!root) {
        console.warn("[Airpad] initAirpadApp: no mount root");
        return;
    }

    const byId = (id: string) => queryAirpad(`#${CSS.escape(id)}`);

    function resetMotionRuntime() {
        resetMotionAccum();
        resetMotionBaseline();
        resetRelativeOrientationRuntimeState();
        log("Motion runtime state reset (recalibrated).");
    }

    function initConfigButton() {
        const configButton = byId("btnConfig");
        if (!configButton) {
            return;
        }
        configButton.addEventListener("click", () => showConfigUI(), { signal });
    }

    function initMotionResetButton() {
        const resetButton = byId("btnMotionReset") as HTMLButtonElement | null;
        if (!resetButton) return;
        resetButton.title = "Reset motion calibration";
        resetButton.addEventListener("click", () => resetMotionRuntime(), { signal });
    }

    function initAdaptiveHintPanel() {
        const hintRoot = byId("hintPanel");
        if (!hintRoot) return;

        const groups = Array.from(hintRoot.querySelectorAll("[data-hint-group]")) as HTMLDetailsElement[];
        if (groups.length === 0) return;

        const compactMedia = globalThis.matchMedia("(max-width: 980px), (max-height: 860px)");
        const applyHintDensity = () => {
            const compact = compactMedia.matches;
            groups.forEach((group) => {
                if (compact) {
                    group.open = false;
                }
            });
        };

        applyHintDensity();
        compactMedia.addEventListener?.("change", applyHintDensity, { signal });
    }

    const initReloadButton = () => {
        // Reload wiring lives in initLogOverlay (btnReload).
    };

    const safeToString = (value: unknown): string => {
        if (value instanceof Error) return `${value.name}: ${value.message}`;
        if (typeof value === "string") return value;
        return String(value);
    };
    const runInitializer = (label: string, initializer: () => void) => {
        try {
            initializer();
        } catch (error) {
            log(`Airpad init [${label}] failed: ${safeToString(error)}`);
        }
    };

    const aborted = (): boolean => Boolean(signal.aborted || (initToken !== undefined && initToken !== airpadInitToken));

    if (aborted()) return;

    const initLogOverlay = () => {
        const overlay = byId("logOverlay");
        const toggle = byId("logToggle");
        const close = byId("logClose");

        if (!overlay || !toggle) {
            return;
        }

        const reload = byId("btnReload");
        reload?.addEventListener(
            "click",
            () => {
                try {
                    globalThis?.location?.reload?.();
                } catch (e) {
                    console.error(e);
                } //@ts-ignore
                try {
                    globalThis?.navigation?.navigate?.("airpad");
                } catch (e) {
                    console.error(e);
                } //@ts-ignore
                try {
                    globalThis?.navigation?.reload?.();
                } catch (e) {
                    console.error(e);
                } //@ts-ignore
            },
            { signal }
        );

        const openOverlay = () => {
            overlay.classList.add("open");
            overlay.setAttribute("aria-hidden", "false");
            toggle.setAttribute("aria-expanded", "true");
        };

        const closeOverlay = () => {
            overlay.classList.remove("open");
            overlay.setAttribute("aria-hidden", "true");
            toggle.setAttribute("aria-expanded", "false");
        };

        toggle.addEventListener("click", openOverlay, { signal });
        close?.addEventListener("click", closeOverlay, { signal });
        overlay.addEventListener(
            "click",
            (e) => {
                if (e.target === overlay) {
                    closeOverlay();
                }
            },
            { signal }
        );
        root.addEventListener(
            "keydown",
            (e) => {
                if (e.key === "Escape" && overlay.classList.contains("open")) {
                    closeOverlay();
                }
            },
            { capture: true, signal }
        );
    };

    const initHintOverlay = () => {
        const overlay = byId("hintOverlay");
        const toggle = byId("hintToggle");
        const close = byId("hintClose");

        if (!overlay || !toggle) {
            return;
        }

        const openOverlay = () => {
            overlay.classList.add("open");
            overlay.setAttribute("aria-hidden", "false");
            toggle.setAttribute("aria-expanded", "true");
        };

        const closeOverlay = () => {
            overlay.classList.remove("open");
            overlay.setAttribute("aria-hidden", "true");
            toggle.setAttribute("aria-expanded", "false");
        };

        toggle.addEventListener("click", openOverlay, { signal });
        close?.addEventListener("click", closeOverlay, { signal });
        overlay.addEventListener(
            "click",
            (e) => {
                if (e.target === overlay) {
                    closeOverlay();
                }
            },
            { signal }
        );
        root.addEventListener(
            "keydown",
            (e) => {
                if (e.key === "Escape" && overlay.classList.contains("open")) {
                    closeOverlay();
                }
            },
            { capture: true, signal }
        );
    };

    // Fresh read from localStorage + sync when another tab changes settings (storage event).
    reloadAirpadRemoteConfigFromStorage();
    airpadCrossTabUnsub ??= attachAirpadCrossTabConfigSync();

    // Phase 1 — sync: DOM is in place; wire controls immediately (no idle wait).
    runInitializer("log overlay", () => initLogOverlay());
    runInitializer("hint overlay", () => initHintOverlay());
    runInitializer("reload button", () => initReloadButton());
    runInitializer("websocket button", () => initAirPadSessionTransport(getBtnConnect()));
    runInitializer("speech", () => initSpeechRecognition());
    runInitializer("AI button", () => initAiButton());
    runInitializer("Air button", () => initAirButton());
    runInitializer("virtual keyboard", () => initVirtualKeyboard(root));
    unsubscribeWsKeyboardSync?.();
    unsubscribeWsKeyboardSync = onAirPadSessionConnectionChange((connected) => {
        setRemoteKeyboardEnabled(connected);
    });
    runInitializer("clipboard toolbar", () => initClipboardToolbar());
    runInitializer("config button", () => initConfigButton());
    runInitializer("adaptive hint", () => initAdaptiveHintPanel());
    runInitializer("motion reset", () => initMotionResetButton());

    log('Готово. Нажми "WS Connect", затем используй Air/AI кнопки.');
    log("Движение мыши основано только на Gyroscope API (повороты телефона).");

    // Phase 2 — sensors: can block main thread on some devices; start after first paint.
    const startSensors = (): void => {
        if (aborted()) return;
        runInitializer("relative orientation", () => initRelativeOrientation());
    };
    if (typeof globalThis.requestIdleCallback === "function") {
        globalThis.requestIdleCallback(startSensors, { timeout: 2000 });
    } else {
        globalThis.setTimeout(startSensors, 0);
    }

    // Phase 3 — SW: main app entry usually registers already; never recurse into initAirpadApp.
    const deferServiceWorker = (): void => {
        if (aborted()) return;
        if (globalThis.location?.protocol === "chrome-extension:") return;
        void initServiceWorker({
            immediate: false,
            onRegistered() {
                log("PWA: service worker registered");
            },
            onRegisterError(error) {
                log("PWA: service worker register error: " + ((error as any)?.message ?? String(error)));
            }
        }).catch((err: unknown) => {
            log("PWA: service worker disabled: " + safeToString(err));
        });
    };
    if (typeof globalThis.requestIdleCallback === "function") {
        globalThis.requestIdleCallback(deferServiceWorker, { timeout: 6000 });
    } else {
        globalThis.setTimeout(deferServiceWorker, 2500);
    }
}
