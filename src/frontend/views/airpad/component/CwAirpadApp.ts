import { H } from "fest/lure";
import { AirpadController } from "./AirpadController";

const TAG = "cw-airpad-app";

class CwAirpadAppElement extends HTMLElement {
    private controller = new AirpadController();
    private started = false;
    private contentHost: HTMLElement | null = null;

    connectedCallback(): void {
        if (!this.isConnected) return;
        this.renderShell();
        void this.start();
    }

    disconnectedCallback(): void {
        this.dispose();
    }

    async start(): Promise<void> {
        if (this.started) return;
        this.renderShell();
        const mount = this.contentHost;
        if (!mount) return;

        try {
            await this.controller.mount(mount);
            this.started = true;
        } catch (error) {
            this.started = false;
            this.renderError(error);
        }
    }

    retry(): void {
        this.started = false;
        this.controller.reset();
        this.renderShell();
        void this.start();
    }

    dispose(): void {
        this.controller.unmount();
        this.started = false;
    }

    private renderShell(): void {
        if (this.contentHost?.isConnected && this.querySelector(".view-airpad")) return;
        this.replaceChildren(
            H`
            <div class="view-airpad">
                <div class="view-airpad__content" data-airpad-content>
                    <div class="view-airpad__loading">
                        <div class="view-airpad__spinner"></div>
                        <span>Loading Airpad...</span>
                    </div>
                </div>
            </div>
        ` as HTMLElement
        );
        this.contentHost = this.querySelector("[data-airpad-content]") as HTMLElement | null;
    }

    private renderError(error: unknown): void {
        if (!this.contentHost) return;
        this.contentHost.innerHTML = `
            <div class="view-airpad__error">
                <p>Failed to load Airpad</p>
                <p class="view-airpad__error-detail">${String(error)}</p>
                <button type="button" data-action="retry">Try Again</button>
            </div>
        `;
        this.contentHost.querySelector("[data-action=\"retry\"]")?.addEventListener("click", () => this.retry());
    }
}

export function ensureCwAirpadAppDefined(): void {
    if (typeof customElements === "undefined") return;
    if (customElements.get(TAG)) return;
    customElements.define(TAG, CwAirpadAppElement);
}

export type CwAirpadApp = CwAirpadAppElement;

