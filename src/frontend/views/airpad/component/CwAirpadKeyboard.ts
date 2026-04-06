const TAG = "cw-airpad-keyboard";

class CwAirpadKeyboardElement extends HTMLElement {}

export function ensureCwAirpadKeyboardDefined(): void {
    const ce = (globalThis as unknown as { customElements?: CustomElementRegistry | null })?.customElements;
    if (!ce || typeof ce.get !== "function" || typeof ce.define !== "function") return;
    if (ce.get(TAG)) return;
    ce.define(TAG, CwAirpadKeyboardElement);
}
