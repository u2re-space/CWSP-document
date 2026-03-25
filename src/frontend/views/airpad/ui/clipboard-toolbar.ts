// =========================
// Clipboard toolbar (Cut / Copy / Paste)
// =========================

import { log, getBtnCut, getBtnCopy, getBtnPaste, getClipboardPreviewEl } from '../utils/utils';
import {
    onAirPadRemoteClipboardUpdate,
    requestAirPadClipboardCopy,
    requestAirPadClipboardCut,
    requestAirPadClipboardPaste,
    requestAirPadClipboardRead,
} from '../network/session';

let unsubscribeClipboardUpdate: (() => void) | null = null;
const boundCopyButtons = new WeakSet<HTMLElement>();
const boundCutButtons = new WeakSet<HTMLElement>();
const boundPasteButtons = new WeakSet<HTMLElement>();

/** Call when Airpad unmounts so a fresh DOM gets listeners on next mount. */
export function resetClipboardToolbarState(): void {
    if (unsubscribeClipboardUpdate) {
        unsubscribeClipboardUpdate();
        unsubscribeClipboardUpdate = null;
    }
}

function setPreview(text: string, meta?: { source?: string }) {
    const clipboardPreviewEl = getClipboardPreviewEl();
    if (!clipboardPreviewEl || typeof clipboardPreviewEl === 'undefined') return;

    const source = meta?.source ? String(meta.source) : 'pc';
    const safeText = String(text ?? '');

    if (!safeText) {
        clipboardPreviewEl.classList.remove('visible');
        clipboardPreviewEl.innerHTML = '';
        return;
    }

    clipboardPreviewEl.innerHTML = `
        <div class="meta">Clipboard (${source})</div>
        <div class="text"></div>
    `;
    const textEl = clipboardPreviewEl.querySelector('.text') as HTMLElement | null;
    if (textEl) textEl.textContent = safeText;
    clipboardPreviewEl.classList.add('visible');
}

async function readPhoneClipboardText(): Promise<string> {
    // Requires HTTPS (or localhost) + user gesture in most browsers.
    const nav: any = navigator as any;
    if (nav?.clipboard?.readText) {
        return await nav.clipboard.readText();
    }
    // Fallback
    return globalThis?.prompt?.('Вставь текст из телефона (clipboard readText недоступен):', '') || '';
}

async function tryWritePhoneClipboardText(text: string): Promise<boolean> {
    const nav: any = navigator as any;
    if (nav?.clipboard?.writeText) {
        try {
            await nav.clipboard.writeText(text);
            return true;
        } catch {
            return false;
        }
    }
    return false;
}

export function initClipboardToolbar() {
    const btnCut = getBtnCut();
    const btnCopy = getBtnCopy();
    const btnPaste = getBtnPaste();

    // Keep preview in sync with backend clipboard events
    if (unsubscribeClipboardUpdate) {
        unsubscribeClipboardUpdate();
    }
    unsubscribeClipboardUpdate = onAirPadRemoteClipboardUpdate((text, meta) => setPreview(text, meta));

    // Best-effort initial fetch (so UI isn't empty)
    requestAirPadClipboardRead().then((res) => {
        if (res?.ok && typeof res.text === 'string') setPreview(res.text, { source: 'pc' });
    });

    if (btnCopy && !boundCopyButtons.has(btnCopy)) {
        boundCopyButtons.add(btnCopy);
        btnCopy.addEventListener('click', async () => {
            const res = await requestAirPadClipboardCopy();
            if (!res?.ok) {
                log('Copy failed: ' + (res?.error || 'unknown'));
                return;
            }

            const text = String(res.text || '');
            setPreview(text, { source: 'pc' });

            // Best-effort: try to write to phone clipboard (may be blocked by browser policies).
            const ok = await tryWritePhoneClipboardText(text);
            if (!ok) {
                log('PC clipboard received. If phone clipboard write is blocked, copy from the preview line.');
            }
        });
    }

    if (btnCut && !boundCutButtons.has(btnCut)) {
        boundCutButtons.add(btnCut);
        btnCut.addEventListener('click', async () => {
            const res = await requestAirPadClipboardCut();
            if (!res?.ok) {
                log('Cut failed: ' + (res?.error || 'unknown'));
                return;
            }

            const text = String(res.text || '');
            setPreview(text, { source: 'pc' });

            const ok = await tryWritePhoneClipboardText(text);
            if (!ok) {
                log('PC clipboard received (after cut). If phone clipboard write is blocked, copy from the preview line.');
            }
        });
    }

    if (btnPaste && !boundPasteButtons.has(btnPaste)) {
        boundPasteButtons.add(btnPaste);
        btnPaste.addEventListener('click', async () => {
            const text = await readPhoneClipboardText();
            if (!text) {
                log('Paste: phone clipboard is empty (or permission denied).');
                return;
            }

            const res = await requestAirPadClipboardPaste(text);
            if (!res?.ok) {
                log('Paste failed: ' + (res?.error || 'unknown'));
                return;
            }

            // Show what we just pasted (useful confirmation)
            setPreview(text, { source: 'phone' });
        });
    }
}


