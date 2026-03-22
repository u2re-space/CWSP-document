// =========================
// Утилиты и DOM элементы
// =========================

/** Airpad markup mount node (set on mount, cleared on unmount). Avoid `document.getElementById` — IDs may not be in the document tree (routed host, shadow, iframe). */
let airpadDomRoot: HTMLElement | null = null;

export function setAirpadDomRoot(root: HTMLElement | null): void {
    airpadDomRoot = root;
}

export function getAirpadDomRoot(): HTMLElement | null {
    return airpadDomRoot;
}

/** Document that owns the Airpad mount (correct when embedded in an iframe). */
export function getAirpadOwnerDocument(): Document | null {
    return airpadDomRoot?.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
    const r = airpadDomRoot;
    if (!r) return null;
    try {
        return r.querySelector(`#${CSS.escape(id)}`) as T | null;
    } catch {
        return null;
    }
}

/** Scoped `querySelector` under the current Airpad mount root. */
export function queryAirpad<T extends HTMLElement = HTMLElement>(selector: string): T | null {
    if (!airpadDomRoot) return null;
    return airpadDomRoot.querySelector(selector) as T | null;
}

// Lazy getters for DOM elements (since HTML is created dynamically)
export const getWsStatusEl = () => byId('wsStatus');
export const getAirStatusEl = () => byId('airStatus');
export const getAiStatusEl = () => byId('aiStatus');
export const getLogEl = () => byId('logContainer'); // Changed to logContainer
export const getVoiceTextEl = () => byId('voiceText');
export const getVkStatusEl = () => byId('vkStatus');

export const getBtnConnect = () => byId('btnConnect');
export const getAirButton = () => byId('airButton');
export const getAiButton = () => byId('aiButton');
export const getAirNeighborButton = () => byId<HTMLButtonElement>('airNeighborButton');

export const getBtnCut = () => byId<HTMLButtonElement>('btnCut');
export const getBtnCopy = () => byId<HTMLButtonElement>('btnCopy');
export const getBtnPaste = () => byId<HTMLButtonElement>('btnPaste');
export const getClipboardPreviewEl = () => byId('clipboardPreview');

// Backward compatibility - return current values or null
export const wsStatusEl = null; // Will be accessed via getter
export const airStatusEl = null;
export const aiStatusEl = null;
export const logEl = null; // Will be accessed via getLogEl()
export const voiceTextEl = null;

export const btnConnect = null; // Will be accessed via getBtnConnect()
export const airButton = null;
export const aiButton = null;

export const btnCut = null;
export const btnCopy = null;
export const btnPaste = null;
export const clipboardPreviewEl = null;

export function log(msg: string) {
    const doc = airpadDomRoot?.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
    if (!doc) {
        console.log('[LOG]', msg);
        return;
    }
    const line = doc.createElement('div');
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    const logContainer = getLogEl();
    if (logContainer) {
        logContainer.appendChild(line);
        // Auto-scroll to bottom
        logContainer.scrollTop = logContainer.scrollHeight;
    }
    console.log('[LOG]', msg);
}

