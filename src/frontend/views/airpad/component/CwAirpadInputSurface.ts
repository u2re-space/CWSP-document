const TAG = "cw-airpad-input-surface";

class CwAirpadInputSurfaceElement extends HTMLElement {}

export function ensureCwAirpadInputSurfaceDefined(): void {
    if (typeof customElements === "undefined") return;
    if (customElements.get(TAG)) return;
    customElements.define(TAG, CwAirpadInputSurfaceElement);
}
