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
import { teardownKeyboardDismissListeners } from "./input/keyboard/handlers";
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
import { AirpadEventBus, type AirpadEventMap } from "./component/AirpadEventBus";
import { ensureCwAirpadActionRailDefined, CwAirpadActionRailElement } from "./component/CwAirpadActionRail";
import { ensureCwAirpadSidePanelsDefined, CwAirpadSidePanelsElement } from "./component/CwAirpadSidePanels";

let unsubscribeWsKeyboardSync: (() => void) | null = null;
let airpadInitToken = 0;
let airpadInitAbort: AbortController | null = null;
let airpadCrossTabUnsub: (() => void) | null = null;

export function unmountAirpadRuntime(): void {
    teardownKeyboardDismissListeners();
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
    ensureCwAirpadActionRailDefined();
    ensureCwAirpadSidePanelsDefined();

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

        <cw-airpad-side-panels></cw-airpad-side-panels>
        <cw-airpad-action-rail></cw-airpad-action-rail>
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
    const bus = new AirpadEventBus();
    const sidePanels = root.querySelector("cw-airpad-side-panels") as CwAirpadSidePanelsElement | null;
    const actionRail = root.querySelector("cw-airpad-action-rail") as CwAirpadActionRailElement | null;
    sidePanels?.connect(bus);
    actionRail?.connect(bus);
    signal.addEventListener("abort", () => {
        sidePanels?.disconnect();
        actionRail?.disconnect();
        bus.clear();
    }, { once: true });
    const bindBus = <K extends keyof AirpadEventMap>(
        event: K,
        handler: (payload: AirpadEventMap[K]) => void
    ): void => {
        const off = bus.on(event, handler);
        signal.addEventListener("abort", off, { once: true });
    };

    function resetMotionRuntime() {
        resetMotionAccum();
        resetMotionBaseline();
        resetRelativeOrientationRuntimeState();
        log("Motion runtime state reset (recalibrated).");
    }

    bindBus("ui.config.open", () => showConfigUI());
    bindBus("ui.motion.reset", () => resetMotionRuntime());
    bindBus("ui.reload.request", () => {
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
    });

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

    // Fresh read from localStorage + sync when another tab changes settings (storage event).
    reloadAirpadRemoteConfigFromStorage();
    airpadCrossTabUnsub ??= attachAirpadCrossTabConfigSync();

    // Phase 1 — sync: DOM is in place; wire controls immediately (no idle wait).
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
    runInitializer("adaptive hint", () => initAdaptiveHintPanel());

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
