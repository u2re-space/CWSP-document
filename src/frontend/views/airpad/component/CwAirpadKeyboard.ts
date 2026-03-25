const TAG = "cw-airpad-keyboard";

class CwAirpadKeyboardElement extends HTMLElement {}

export function ensureCwAirpadKeyboardDefined(): void {
    if (typeof customElements === "undefined") return;
    if (customElements.get(TAG)) return;
    customElements.define(TAG, CwAirpadKeyboardElement);
}
