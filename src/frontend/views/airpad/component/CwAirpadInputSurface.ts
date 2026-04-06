const TAG = "cw-airpad-input-surface";

class CwAirpadInputSurfaceElement extends HTMLElement {}

export function ensureCwAirpadInputSurfaceDefined(): void {
    const ce = (globalThis as unknown as { customElements?: CustomElementRegistry | null })?.customElements;
    if (!ce || typeof ce.get !== "function" || typeof ce.define !== "function") return;
    if (ce.get(TAG)) return;
    ce.define(TAG, CwAirpadInputSurfaceElement);
}
