/* WHY: Vite 8 still injects @vite/client when hmr:false. Workers have no HTMLElement. */
console.debug("[vite] HMR disabled");
const noop = () => {};
export const createHotContext = () => ({
    data: {},
    accept: noop,
    dispose: noop,
    prune: noop,
    invalidate: noop,
    on: noop,
    off: noop,
    send: noop,
});
export const updateStyle = noop;
export const removeStyle = noop;
export const injectQuery = (url) => url;
const OverlayBase = typeof globalThis.HTMLElement === "function" ? globalThis.HTMLElement : class {};
export class ErrorOverlay extends OverlayBase {}
