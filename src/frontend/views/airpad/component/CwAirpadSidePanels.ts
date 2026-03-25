import { AirpadEventBus } from "./AirpadEventBus";

const TAG = "cw-airpad-side-panels";

export class CwAirpadSidePanelsElement extends HTMLElement {
    private abort: AbortController | null = null;

    connectedCallback(): void {
        this.ensureRendered();
    }

    disconnectedCallback(): void {
        this.disconnect();
    }

    connect(bus: AirpadEventBus): void {
        this.disconnect();
        this.ensureRendered();
        this.abort = new AbortController();
        const signal = this.abort.signal;
        const byId = (id: string) => this.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null;
        const hookOverlay = (toggleId: string, overlayId: string, closeId: string): void => {
            const overlay = byId(overlayId);
            const toggle = byId(toggleId);
            const close = byId(closeId);
            if (!overlay || !toggle) return;
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
            overlay.addEventListener("click", (e) => {
                if (e.target === overlay) closeOverlay();
            }, { signal });
            this.addEventListener("keydown", (e) => {
                if (e.key === "Escape" && overlay.classList.contains("open")) closeOverlay();
            }, { capture: true, signal });
        };

        hookOverlay("logToggle", "logOverlay", "logClose");
        hookOverlay("hintToggle", "hintOverlay", "hintClose");

        byId("btnReload")?.addEventListener("click", () => bus.emit("ui.reload.request", undefined), { signal });
        byId("btnMotionReset")?.addEventListener("click", () => bus.emit("ui.motion.reset", undefined), { signal });
    }

    disconnect(): void {
        this.abort?.abort();
        this.abort = null;
    }

    private ensureRendered(): void {
        if (this.querySelector("#logOverlay")) return;
        this.innerHTML = `
            <div class="side-actions-row" role="group" aria-label="Panels">
                <button type="button" id="hintToggle" name="airpad-hints-toggle" class="side-log-toggle side-hint-toggle" aria-controls="hintOverlay" aria-expanded="false">Hints</button>
                <button type="button" id="logToggle" name="airpad-log-toggle" class="side-log-toggle" aria-controls="logOverlay" aria-expanded="false">Логи</button>
                <button type="button" id="btnMotionReset" name="airpad-motion-reset" class="side-log-toggle side-fix-toggle" aria-label="Reset motion calibration">Fix</button>
                <button type="button" id="btnReload" name="airpad-reload" class="side-log-toggle side-reload-toggle" aria-label="Reload">Reload</button>
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
                            <ul><li>Короткий тап — клик.</li><li>Удержание &gt; 100ms — режим air-мыши.</li><li>Свайп вверх/вниз по кнопке — скролл.</li><li>Свайп влево/вправо — жест.</li></ul>
                        </details>
                        <details class="hint-group" data-hint-group>
                            <summary>AI-кнопка</summary>
                            <ul><li>Нажми и держи — идёт распознавание речи.</li><li>Отпусти — команда уйдёт в endpoint voice pipeline.</li></ul>
                        </details>
                        <details class="hint-group" data-hint-group>
                            <summary>Виртуальная клавиатура</summary>
                            <ul><li>Открой кнопкой ⌨️ на нижней панели.</li><li>Поддерживает текст, эмодзи и спецсимволы.</li><li>Передаёт ввод в бинарном формате.</li></ul>
                        </details>
                    </section>
                </div>
            </div>
        `;
    }
}

export function ensureCwAirpadSidePanelsDefined(): void {
    if (typeof customElements === "undefined") return;
    if (customElements.get(TAG)) return;
    customElements.define(TAG, CwAirpadSidePanelsElement);
}
