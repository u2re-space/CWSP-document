/**
 * Airpad View
 * 
 * Shell-agnostic air trackpad + AI assistant component.
 * Wraps the existing airpad functionality as a view.
 */

import { H } from "fest/lure";
import { loadAsAdopted, removeAdopted } from "fest/dom";
import type { ViewOptions as ShellViewOptions, ViewLifecycle } from "shells/types";
import type { BaseViewOptions } from "views/types";
import type { ViewOptions as RegistryViewOptions } from "../registry";
import { createViewConstructor, ViewBase } from "../registry";
import { setRemoteKeyboardEnabled } from "./input/virtual-keyboard";
import { ensureCwAirpadAppDefined, type CwAirpadApp } from "./component/CwAirpadApp";
import { AirpadChannelAction } from "views/apis/channel-actions";

// @ts-ignore
import style from "./airpad.scss?inline";

export type AirpadViewOptions = BaseViewOptions;

export const TAG = "cw-airpad-view";

// ============================================================================
// AIRPAD VIEW
// ============================================================================

export const CwAirpadView = createViewConstructor(TAG, (Base: typeof ViewBase) => {
    return class AirpadView extends Base {
    id = "airpad" as const;
    name = "Airpad";
    icon = "hand-pointing";

    private element: HTMLElement | null = null;
    private appElement: CwAirpadApp | null = null;
    private initialized = false;
    private initPromise: Promise<void> | null = null;
    
    private _sheet: CSSStyleSheet | null = null;
    private _orientationLocked = false;

    lifecycle: ViewLifecycle = {
        onMount: () => this.initAirpad(),
        onUnmount: () => this.cleanup(),
        onShow: () => {
            this._sheet = loadAsAdopted(style) as CSSStyleSheet;
            void this.lockOrientationForAirpad();
            // If the shell re-rendered a detached root without re-running onMount, finish init here.
            if (!this.initialized) {
                void this.initAirpad();
            }
        },
        onHide: () => {
            setRemoteKeyboardEnabled(false);
            this.unlockOrientationForAirpad();
            removeAdopted(this._sheet);
        },
    };

    constructor(options?: BaseViewOptions) {
        super();
        if (options) {
            this.options = options as unknown as RegistryViewOptions;
        }
    }

    /** Shell passes shell `ViewOptions`; registry `ViewBase` uses a narrower options bag — merge via cast. */
    render = (options?: ShellViewOptions): HTMLElement => {
        if (options) {
            this.options = {
                ...(this.options as object),
                ...(options as object)
            } as RegistryViewOptions;
        }

        // If the view root is being re-created (e.g. after shell cache refresh),
        // drop previous runtime state so the new container does not stay on loader forever.
        if (this.initialized) {
            this.cleanup();
        }

        this._sheet = loadAsAdopted(style) as CSSStyleSheet;
        ensureCwAirpadAppDefined();

        this.element = H`
            <cw-airpad-app data-airpad-app></cw-airpad-app>
        ` as HTMLElement;
        this.appElement = this.element as unknown as CwAirpadApp;

        // Init runs from lifecycle.onMount (after shell wires the view) to avoid double-start
        // and to match other views; keeps a single code path.

        return this.element;
    };

    getToolbar(): HTMLElement | null {
        return null;
    }

    // ========================================================================
    // PRIVATE METHODS
    // ========================================================================

    private async initAirpad(): Promise<void> {
        if (this.initialized) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            const app = this.appElement ?? (this.element as unknown as CwAirpadApp | null);
            if (!app) return;

            try {
                await app.start?.();
                await this.lockOrientationForAirpad()?.catch?.((error) => { console.error("[Airpad] Failed to lock orientation:", error); });
                this.initialized = true;
            } catch (error) {
                console.error("[Airpad] Failed to initialize:", error);
                this.appElement?.retry?.();
            } finally {
                this.initPromise = null;
            }
        })();

        return this.initPromise;
    }

    private cleanup(): void {
        this.appElement?.dispose?.();
        this.unlockOrientationForAirpad();
        this.initialized = false;
        this.initPromise = null;
        this.appElement = null;
    }

    private async lockOrientationForAirpad(): Promise<void> {
        try {
            const orientationApi = globalThis?.screen?.orientation as ScreenOrientation & {
                lock?: (type: OrientationType) => Promise<void>;
            };
            if (!orientationApi || typeof orientationApi.lock !== "function") return;

            const type = (String(orientationApi.type || "").toLowerCase()) || "natural";
            const lockType = type as OrientationType;
            await orientationApi.lock(lockType);
            this._orientationLocked = true;
        } catch {
            // Orientation lock can fail outside installed/fullscreen contexts.
            this._orientationLocked = false;
        }
    }

    private unlockOrientationForAirpad(): void {
        try {
            if (!this._orientationLocked) return;
            const orientationApi = globalThis?.screen?.orientation as ScreenOrientation | undefined;
            if (!orientationApi || typeof orientationApi.unlock !== "function") return;
            orientationApi.unlock();
        } catch {
            // no-op
        } finally {
            this._orientationLocked = false;
        }
    }

    async invokeChannelApi(action: string, _payload?: unknown): Promise<unknown> {
        switch (action) {
            case AirpadChannelAction.Start:
            case AirpadChannelAction.AirpadStart:
                return this.initAirpad();
            case AirpadChannelAction.Retry:
                this.appElement?.retry?.();
                return true;
            default:
                return undefined;
        }
    }

    canHandleMessage(): boolean {
        return false;
    }

    async handleMessage(): Promise<void> {}
    }
}) as CustomElementConstructor;

export function createAirpadView(options?: BaseViewOptions) {
    return new CwAirpadView(options);
}

export default createAirpadView;
