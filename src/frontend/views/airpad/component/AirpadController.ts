import { disconnectAirPadSession } from "../network/session";
import { setRemoteKeyboardEnabled } from "../input/virtual-keyboard";
import { unmountAirpadRuntime } from "../main";
import { waitForDomPaint } from "@rs-frontend/shared/event-handling-policy";

export class AirpadController {
    private initialized = false;
    private mountPromise: Promise<void> | null = null;

    async mount(contentHost: HTMLElement): Promise<void> {
        if (this.initialized) return;
        if (this.mountPromise) return this.mountPromise;

        this.mountPromise = (async () => {
            const { default: mountAirpad } = await import("../main");

            contentHost.innerHTML = "";
            await waitForDomPaint();
            await mountAirpad(contentHost);
            this.initialized = true;
        })().finally(() => {
            this.mountPromise = null;
        });

        return this.mountPromise;
    }

    unmount(): void {
        unmountAirpadRuntime();
        setRemoteKeyboardEnabled(false);
        disconnectAirPadSession();
        this.initialized = false;
        this.mountPromise = null;
    }

    reset(): void {
        this.initialized = false;
        this.mountPromise = null;
    }
}

