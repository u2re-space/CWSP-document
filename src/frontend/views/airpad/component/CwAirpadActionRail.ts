import { AirpadEventBus } from "./AirpadEventBus";

const TAG = "cw-airpad-action-rail";

export class CwAirpadActionRailElement extends HTMLElement {
    private abort: AbortController | null = null;

    connectedCallback(): void {
        this.ensureRendered();
    }

    disconnectedCallback(): void {
        this.disconnect();
    }

    connect(bus: AirpadEventBus): void {
        this.disconnect();
        // `initAirpadApp` can run in the same turn as `replaceChildren`; `connectedCallback`
        // may not have run yet, so markup must exist before attaching listeners.
        this.ensureRendered();
        this.abort = new AbortController();
        const signal = this.abort.signal;
        // Delegation survives innerHTML churn (e.g. keyboard toggle insertion) and avoids
        // missed targets when connect() races connectedCallback.
        this.addEventListener(
            "click",
            (e) => {
                const t = e.target;
                if (!(t instanceof Element)) return;
                if (!this.contains(t)) return;
                if (t.closest("#btnConfig")) {
                    bus.emit("ui.config.open", undefined);
                }
                // WS ↔ is wired by `initWebSocket(getBtnConnect())` — do not duplicate here.
            },
            { capture: true, signal }
        );
    }

    disconnect(): void {
        this.abort?.abort();
        this.abort = null;
    }

    private ensureRendered(): void {
        if (this.querySelector("#clipboardToolbar")) return;
        this.innerHTML = `
            <div class="bottom-toolbar" id="clipboardToolbar" aria-label="Clipboard actions">
                <button type="button" id="btnCut" name="airpad-clipboard-cut" class="toolbar-btn" aria-label="Cut (Ctrl+X)">✂️</button>
                <button type="button" id="btnCopy" name="airpad-clipboard-copy" class="toolbar-btn" aria-label="Copy (Ctrl+C)">📋</button>
                <button type="button" id="btnPaste" name="airpad-clipboard-paste" class="toolbar-btn" aria-label="Paste (Ctrl+V)">📥</button>
                <button type="button" id="btnConnect" name="airpad-ws-connect" class="toolbar-btn connect-fab connect-fab--ws">WS ↔</button>
                <button type="button" id="btnConfig" name="airpad-config" class="toolbar-btn" aria-label="Configuration" title="Configuration">⚙️</button>
            </div>
            <div id="clipboardPreview" class="clipboard-preview" aria-live="polite"></div>
        `;
    }
}

export function ensureCwAirpadActionRailDefined(): void {
    if (typeof customElements === "undefined") return;
    if (customElements.get(TAG)) return;
    customElements.define(TAG, CwAirpadActionRailElement);
}
