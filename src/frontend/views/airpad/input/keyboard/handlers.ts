// =========================
// Keyboard Event Handlers
// =========================

import { stopBubbling } from '@rs-frontend/shared/event-handling-policy';
import { eventTargetElement } from '@rs-core/document/DocTools';
import { getAirpadOwnerDocument, log, getVkStatusEl } from '../../utils/utils';
import { sendKeyboardChar } from './message';
import { getVirtualKeyboardAPI } from './api';
import {
    isKeyboardVisible,
    setKeyboardVisible,
    getKeyboardElement,
    getToggleButton,
    isRemoteKeyboardEnabled
} from './state';
import { renderKeyboard, renderEmoji, restoreButtonIcon } from './ui';

const DEBUG_KEYBOARD_INPUT = false;
/** AbortController for document-level dismiss listeners (scoped to airpad owner document). */
let keyboardDismissAbort: AbortController | null = null;

/** Remove focus/pointer dismiss listeners (call on Airpad unmount). */
export function teardownKeyboardDismissListeners(): void {
    try {
        keyboardDismissAbort?.abort();
    } catch {
        /* ignore */
    }
    keyboardDismissAbort = null;
}

const keyboardToggleClickBound = new WeakSet<Element>();
const keyboardToggleApiBound = new WeakSet<Element>();
const keyboardContainerUiBound = new WeakSet<Element>();

/** Outside taps must not close the keyboard when interacting with these regions. */
const KEYBOARD_STAYS_OPEN_MATCHES = 'input,textarea,select,[contenteditable="true"]';
const KEYBOARD_STAYS_OPEN_CLOSEST =
    '.config-overlay, .virtual-keyboard-container, .keyboard-toggle, .view-airpad, .view-airpad button, .view-airpad .big-button, .view-airpad .neighbor-button, .log-overlay.open, .log-panel, .airpad-config-overlay';

function isKeyboardStayOpenTarget(el: HTMLElement | null | undefined): boolean {
    if (!el) return false;
    return Boolean(
        el.matches?.(KEYBOARD_STAYS_OPEN_MATCHES) || el.closest?.(KEYBOARD_STAYS_OPEN_CLOSEST),
    );
}

function isConfigOverlayVisible(): boolean {
    const doc = getAirpadOwnerDocument();
    const overlay =
        (doc?.querySelector('.airpad-config-overlay') as HTMLElement | null) ??
        (doc?.querySelector('.config-overlay') as HTMLElement | null);
    if (!overlay) return false;
    return overlay.style.display === 'flex' || overlay.classList.contains('flex');
}

function setVkStatus(text: string): void {
    const vkStatusEl = getVkStatusEl();
    if (vkStatusEl) vkStatusEl.textContent = text;
}

// Show keyboard
export function showKeyboard() {
    if (!isRemoteKeyboardEnabled()) return;

    // Don't show keyboard if config dialog is open
    if (isConfigOverlayVisible()) {
        return;
    }

    const keyboardElement = getKeyboardElement();
    //if (!keyboardElement) return;

    const virtualKeyboardAPI = getVirtualKeyboardAPI();
    const toggleButton = getToggleButton();

    if (virtualKeyboardAPI) {
        if (toggleButton) {
            toggleButton.contentEditable = 'true';
            toggleButton.setAttribute('virtualkeyboardpolicy', 'manual');
        }
        restoreButtonIcon();
        toggleButton?.focus({ preventScroll: true });
        virtualKeyboardAPI.show();
        setVkStatus('overlay:on / policy:manual');
    } else {
        setKeyboardVisible(true);
        keyboardElement?.classList?.add?.('visible');
        setVkStatus('overlay:off');
    }

    renderKeyboard(false);
    renderEmoji('smileys');
}

// Flag to prevent recursive hideKeyboard calls
let isHidingKeyboard = false;

// Hide keyboard
export function hideKeyboard() {
    // Prevent recursive calls
    if (isHidingKeyboard) return;
    isHidingKeyboard = true;

    try {
        const keyboardElement = getKeyboardElement();
        //if (!keyboardElement) return;

        const virtualKeyboardAPI = getVirtualKeyboardAPI();
        const toggleButton = getToggleButton();
        //toggleButton?.focus?.();

        setKeyboardVisible(false);
        keyboardElement?.classList?.remove?.('visible');

        if (virtualKeyboardAPI) {
            restoreButtonIcon();
            virtualKeyboardAPI.hide();
            if (toggleButton) {
                toggleButton.contentEditable = 'false';
                toggleButton.removeAttribute('virtualkeyboardpolicy');
            }
            toggleButton?.blur();
            setVkStatus('overlay:on / policy:auto');
        }
    } finally {
        isHidingKeyboard = false;
    }
}

// Toggle keyboard visibility
export function toggleKeyboard() {
    if (isKeyboardVisible()) {
        hideKeyboard();
    } else {
        showKeyboard();
    }
}

// Setup toggle button click handler
export function setupToggleButtonHandler() {
    const toggleButton = getToggleButton();

    if (!toggleButton) return;
    if (keyboardToggleClickBound.has(toggleButton)) return;
    keyboardToggleClickBound.add(toggleButton);

    toggleButton.addEventListener('click', (e) => {
        // Block bubble to underlying UI (e.g. details/summary); do not use stopImmediatePropagation.
        stopBubbling(e);

        if (!isRemoteKeyboardEnabled()) {
            log('Keyboard is available after WS connection');
            return;
        }

        // Don't allow keyboard toggle if config dialog is open
        if (isConfigOverlayVisible()) {
            return;
        }

        toggleKeyboard();
    });
}

// Setup VirtualKeyboard API input handlers
export function setupVirtualKeyboardAPIHandlers() {
    const virtualKeyboardAPI = getVirtualKeyboardAPI();
    const toggleButton = getToggleButton();

    if (!virtualKeyboardAPI || !toggleButton) return;
    if (keyboardToggleApiBound.has(toggleButton)) return;
    keyboardToggleApiBound.add(toggleButton);

    const ICON = '⌨️';
    let pendingRestore: number | null = null;

    // Track what was handled to prevent duplicates
    let lastHandledKey: string | null = null;
    let lastHandledTime: number = 0;
    const DEDUP_WINDOW_MS = 20;

    // Track if we're waiting for input event after Unidentified keydown
    let waitingForInput = false;

    // Track last known content for diff-based input detection
    let lastKnownContent = ICON;

    // Track if beforeinput fired (to know if input is fallback)
    let beforeInputFired = false;

    // ==================
    // COMPOSITION STATE - Track incremental composition
    // ==================
    let isComposing = false;
    let lastCompositionText = ''; // Track what we've already sent during composition
    let compositionTimeout: number | null = null;
    const COMPOSITION_TIMEOUT_MS = 600;

    // Reset composition state
    const resetCompositionState = (immediate: boolean = false) => {
        if (compositionTimeout !== null) {
            clearTimeout(compositionTimeout);
            compositionTimeout = null;
        }

        if (immediate) {
            isComposing = false;
            lastCompositionText = '';
        } else {
            compositionTimeout = globalThis.setTimeout(() => {
                isComposing = false;
                lastCompositionText = '';
                compositionTimeout = null;
            }, COMPOSITION_TIMEOUT_MS) as unknown as number;
        }
    };

    // Helper to check if we should skip (already handled recently)
    const shouldSkipDuplicate = (key: string): boolean => {
        const normalizedKey = key.includes(':') ? key.split(':').slice(1).join(':') : key;
        const now = Date.now();
        if (lastHandledKey === normalizedKey && (now - lastHandledTime) < DEDUP_WINDOW_MS) {
            return true;
        }
        lastHandledKey = normalizedKey;
        lastHandledTime = now;
        return false;
    };

    // Helper to schedule icon restore with debounce
    const scheduleRestore = () => {
        queueMicrotask(() => {
            pendingRestore = null;
            restoreButtonIcon();
            lastKnownContent = ICON;
        /*if (pendingRestore !== null) {
            clearTimeout(pendingRestore);
        }
        pendingRestore = globalThis?.setTimeout(() => {
            pendingRestore = null;
            restoreButtonIcon();
            lastKnownContent = ICON;
        }, 1);*/
        });
    };

    // Helper to send char and restore
    const sendAndRestore = (char: string) => {
        if (!isRemoteKeyboardEnabled()) return;
        sendKeyboardChar(char);
        scheduleRestore();
    };

    const TEXT_STREAM_CHUNK_SIZE = 256;
    const TEXT_STREAM_SOFT_LIMIT = 12000;
    const TEXT_STREAM_HARD_LIMIT = 120000;
    let streamToken = 0;
    const sendTextChunked = (text: string, dedupeKey?: string) => {
        const raw = String(text || "");
        if (!raw) {
            scheduleRestore();
            return;
        }
        if (dedupeKey && shouldSkipDuplicate(dedupeKey)) {
            scheduleRestore();
            return;
        }

        let safe = raw;
        if (safe.length > TEXT_STREAM_HARD_LIMIT) {
            safe = safe.slice(0, TEXT_STREAM_HARD_LIMIT);
            log(`[AirPad] Input truncated to ${TEXT_STREAM_HARD_LIMIT} chars to avoid UI freeze.`);
        } else if (safe.length > TEXT_STREAM_SOFT_LIMIT) {
            log(`[AirPad] Streaming large input (${safe.length} chars) in chunks.`);
        }

        const token = ++streamToken;
        let index = 0;
        const pump = () => {
            if (token !== streamToken) return;
            if (!isRemoteKeyboardEnabled()) return;
            const end = Math.min(index + TEXT_STREAM_CHUNK_SIZE, safe.length);
            for (let i = index; i < end; i++) {
                sendKeyboardChar(safe[i]!);
            }
            index = end;
            if (index < safe.length) {
                globalThis.setTimeout(pump, 0);
                return;
            }
            scheduleRestore();
        };
        pump();
    };

    /** IME/composition: cancel in-flight chunked sends when a new update arrives (latest wins). */
    let compositionPumpGen = 0;

    const sendCompositionTextChunked = (text: string, onDone?: () => void) => {
        const raw = String(text || "");
        if (!raw) {
            onDone?.();
            return;
        }
        let safe = raw;
        if (safe.length > TEXT_STREAM_HARD_LIMIT) {
            safe = safe.slice(0, TEXT_STREAM_HARD_LIMIT);
            log(`[AirPad] Composition text truncated to ${TEXT_STREAM_HARD_LIMIT} chars to avoid UI freeze.`);
        } else if (safe.length > TEXT_STREAM_SOFT_LIMIT) {
            log(`[AirPad] Streaming large composition input (${safe.length} chars) in chunks.`);
        }
        const gen = compositionPumpGen;
        let index = 0;
        const pump = () => {
            if (gen !== compositionPumpGen) return;
            if (!isRemoteKeyboardEnabled()) return;
            const end = Math.min(index + TEXT_STREAM_CHUNK_SIZE, safe.length);
            for (let i = index; i < end; i++) {
                sendKeyboardChar(safe[i]!);
            }
            index = end;
            if (index < safe.length) {
                globalThis.setTimeout(pump, 0);
                return;
            }
            onDone?.();
        };
        pump();
    };

    const sendCompositionBackspacesChunked = (count: number, onDone?: () => void) => {
        if (count <= 0) {
            onDone?.();
            return;
        }
        const gen = compositionPumpGen;
        let remaining = count;
        const pump = () => {
            if (gen !== compositionPumpGen) return;
            if (!isRemoteKeyboardEnabled()) return;
            const n = Math.min(remaining, TEXT_STREAM_CHUNK_SIZE);
            for (let i = 0; i < n; i++) {
                sendKeyboardChar('\b');
            }
            remaining -= n;
            if (remaining > 0) {
                globalThis.setTimeout(pump, 0);
                return;
            }
            onDone?.();
        };
        pump();
    };

    const sendCompositionReplaceChunked = (backspaceCount: number, newText: string, onDone: () => void) => {
        let t = String(newText || "");
        if (t.length > TEXT_STREAM_HARD_LIMIT) {
            t = t.slice(0, TEXT_STREAM_HARD_LIMIT);
            log(`[AirPad] Composition replacement truncated to ${TEXT_STREAM_HARD_LIMIT} chars.`);
        }
        sendCompositionBackspacesChunked(backspaceCount, () => {
            if (!t) {
                onDone();
                return;
            }
            sendCompositionTextChunked(t, onDone);
        });
    };

    /** Small IME deltas stay synchronous to preserve ordering with lastCompositionText. */
    const COMPOSITION_INLINE_MAX = 256;

    // Helper to extract clean text (without icon)
    const getCleanText = (text: string): string => {
        return text
            .replace(/⌨️/g, '')
            .replace(/⌨\uFE0F?/g, '')
            .replace(/\uFE0F/g, '');
    };

    // Helper to find new characters by comparing strings
    const findNewCharacters = (currentText: string, previousText: string): string => {
        const cleanCurrent = getCleanText(currentText);
        const cleanPrevious = getCleanText(previousText);

        // If current starts with previous, return the new part
        if (cleanCurrent.startsWith(cleanPrevious)) {
            return cleanCurrent.slice(cleanPrevious.length);
        }

        // If previous starts with current, characters were deleted
        if (cleanPrevious.startsWith(cleanCurrent)) {
            return ''; // Deletion, not addition
        }

        // Complete change - return all new text
        return cleanCurrent;
    };

    // ==================
    // KEYDOWN - Special keys + detect Unidentified for mobile
    // ==================
    toggleButton.addEventListener('keydown', (e) => {
        if (!isRemoteKeyboardEnabled()) return;

        // Check native isComposing flag
        if (e.isComposing) {
            if (compositionTimeout !== null) {
                clearTimeout(compositionTimeout);
                compositionTimeout = null;
            }
            return;
        }

        // Trust event's isComposing over our flag
        if (isComposing && !e.isComposing) {
            resetCompositionState(true);
        }

        beforeInputFired = false;

        // Avoid browser-native copy/cut on the contenteditable keyboard toggle (can freeze on some engines).
        if ((e.ctrlKey || e.metaKey) && !e.altKey) {
            const lowerKey = String(e.key || '').toLowerCase();
            if (lowerKey === 'c' || lowerKey === 'x') {
                e.preventDefault();
                waitingForInput = false;
                resetCompositionState(true);
                return;
            }
        }

        // Backspace / Delete
        if (e.key === 'Backspace' || e.key === 'Delete') {
            e.preventDefault();
            waitingForInput = false;
            if (!shouldSkipDuplicate('backspace')) {
                sendAndRestore('\b');
            }
            return;
        }

        // Enter
        if (e.key === 'Enter') {
            e.preventDefault();
            waitingForInput = false;
            resetCompositionState(true);
            if (!shouldSkipDuplicate('enter')) {
                sendAndRestore('\n');
            }
            return;
        }

        // Tab
        if (e.key === 'Tab') {
            e.preventDefault();
            waitingForInput = false;
            if (!shouldSkipDuplicate('tab')) {
                sendAndRestore('\t');
            }
            return;
        }

        // Unidentified / Process - mobile virtual keyboards
        if (e.key === 'Unidentified' || e.key === 'Process' || e.key === '') {
            waitingForInput = true;
            lastKnownContent = toggleButton.textContent || ICON;
            return;
        }

        // Space
        if (e.key === ' ') {
            e.preventDefault();
            waitingForInput = false;
            resetCompositionState(true);
            return;
        }

        // Printable characters
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            waitingForInput = false;
            return;
        }

        waitingForInput = false;
    });

    // ==================
    // BEFOREINPUT - Main handler for text input
    // ==================
    toggleButton.addEventListener('beforeinput', (e) => {
        if (!isRemoteKeyboardEnabled()) return;

        const inputEvent = e as InputEvent;
        lastKnownContent = toggleButton.textContent || ICON;
        beforeInputFired = true;

        // Let composition input through - we handle it in compositionupdate
        if (inputEvent.inputType === 'insertCompositionText') {
            if (compositionTimeout !== null) {
                clearTimeout(compositionTimeout);
                compositionTimeout = null;
            }
            return;
        }

        // insertText while composing means composition ended naturally
        if (inputEvent.inputType === 'insertText' && isComposing) {
            resetCompositionState(true);
        }

        // Handle Unidentified key
        if (waitingForInput && inputEvent.inputType === 'insertText' && inputEvent.data) {
            e.preventDefault();
            waitingForInput = false;
            sendTextChunked(inputEvent.data, `text:${inputEvent.data}`);
            return;
        }

        // insertText - regular character input
        if (inputEvent.inputType === 'insertText') {
            e.preventDefault();
            const data = inputEvent.data;
            if (data) sendTextChunked(data, `text:${data}`);
            return;
        }

        // insertReplacementText - autocomplete/suggestions
        if (inputEvent.inputType === 'insertReplacementText') {
            e.preventDefault();
            resetCompositionState(true);
            const data = inputEvent.data || (inputEvent as any).dataTransfer?.getData('text');
            if (data) sendTextChunked(data, `replace:${data}`);
            return;
        }

        // insertLineBreak / insertParagraph
        if (inputEvent.inputType === 'insertLineBreak' || inputEvent.inputType === 'insertParagraph') {
            e.preventDefault();
            resetCompositionState(true);
            if (!shouldSkipDuplicate('linebreak')) {
                sendAndRestore('\n');
            }
            return;
        }

        // deleteContentBackward / deleteContentForward
        if (inputEvent.inputType === 'deleteContentBackward' || inputEvent.inputType === 'deleteContentForward') {
            e.preventDefault();
            if (!shouldSkipDuplicate('deleteback')) {
                sendAndRestore('\b');
            }
            return;
        }

        // insertFromPaste
        if (inputEvent.inputType === 'insertFromPaste') {
            e.preventDefault();
            resetCompositionState(true);
            const data = inputEvent.data || (inputEvent as any).dataTransfer?.getData('text/plain');
            if (data) sendTextChunked(data);
            return;
        }
    });

    // ==================
    // COMPOSITION - Send characters incrementally during compositionupdate
    // ==================
    toggleButton.addEventListener('compositionstart', () => {
        if (!isRemoteKeyboardEnabled()) return;

        if (compositionTimeout !== null) {
            clearTimeout(compositionTimeout);
            compositionTimeout = null;
        }
        isComposing = true;
        lastCompositionText = '';
        waitingForInput = false;
        compositionPumpGen++;
        if (DEBUG_KEYBOARD_INPUT) console.log('[Composition] start');
    });

    toggleButton.addEventListener('compositionupdate', (e) => {
        if (!isRemoteKeyboardEnabled()) return;

        if (compositionTimeout !== null) {
            clearTimeout(compositionTimeout);
            compositionTimeout = null;
        }

        compositionPumpGen++;
        const currentText = e.data || '';
        if (DEBUG_KEYBOARD_INPUT) console.log('[Composition] update:', currentText, 'last:', lastCompositionText);

        const finishUpdate = () => {
            lastCompositionText = currentText;
            scheduleRestore();
        };

        // Find what's new since last update
        if (currentText.startsWith(lastCompositionText)) {
            // Characters were added
            const newChars = currentText.slice(lastCompositionText.length);
            if (newChars.length > 0) {
                if (DEBUG_KEYBOARD_INPUT) console.log('[Composition] sending new chars:', newChars);
                if (newChars.length <= COMPOSITION_INLINE_MAX) {
                    for (const char of newChars) {
                        sendKeyboardChar(char);
                    }
                    finishUpdate();
                } else {
                    sendCompositionTextChunked(newChars, finishUpdate);
                }
            } else {
                finishUpdate();
            }
        } else if (lastCompositionText.startsWith(currentText)) {
            // Characters were deleted (backspace during composition)
            const deletedCount = lastCompositionText.length - currentText.length;
            if (DEBUG_KEYBOARD_INPUT) console.log('[Composition] deleted chars:', deletedCount);
            if (deletedCount <= COMPOSITION_INLINE_MAX) {
                for (let i = 0; i < deletedCount; i++) {
                    sendKeyboardChar('\b');
                }
                finishUpdate();
            } else {
                sendCompositionBackspacesChunked(deletedCount, finishUpdate);
            }
        } else {
            // Complete replacement (autocorrect, word selection)
            if (DEBUG_KEYBOARD_INPUT) console.log('[Composition] replacement detected');
            const bs = lastCompositionText.length;
            if (bs <= COMPOSITION_INLINE_MAX && currentText.length <= COMPOSITION_INLINE_MAX) {
                for (let i = 0; i < bs; i++) {
                    sendKeyboardChar('\b');
                }
                for (const char of currentText) {
                    sendKeyboardChar(char);
                }
                finishUpdate();
            } else {
                sendCompositionReplaceChunked(bs, currentText, finishUpdate);
            }
        }
    });

    toggleButton.addEventListener('compositionend', (e) => {
        if (!isRemoteKeyboardEnabled()) return;

        if (DEBUG_KEYBOARD_INPUT) console.log('[Composition] end:', e.data, 'lastSent:', lastCompositionText);

        if (compositionTimeout !== null) {
            clearTimeout(compositionTimeout);
            compositionTimeout = null;
        }

        compositionPumpGen++;
        const finalText = e.data || '';

        // Check if compositionend brings new data not sent via update
        // This happens when user selects from autocomplete suggestions
        const finishEnd = () => {
            isComposing = false;
            lastCompositionText = '';
            scheduleRestore();
        };

        if (finalText !== lastCompositionText) {
            const bs = lastCompositionText.length;
            if (bs <= COMPOSITION_INLINE_MAX && finalText.length <= COMPOSITION_INLINE_MAX) {
                for (let i = 0; i < bs; i++) {
                    sendKeyboardChar('\b');
                }
                for (const char of finalText) {
                    sendKeyboardChar(char);
                }
                finishEnd();
            } else {
                sendCompositionReplaceChunked(bs, finalText, finishEnd);
            }
        } else {
            finishEnd();
        }
    });

    // ==================
    // INPUT - Fallback handler
    // ==================
    toggleButton.addEventListener('input', (e) => {
        if (!isRemoteKeyboardEnabled()) return;

        const inputEvent = e as InputEvent;

        // Skip composition-related input - handled by composition events
        if (inputEvent.inputType === 'insertCompositionText' ||
            inputEvent.inputType?.includes('Composition')) {
            return;
        }

        // If we're composing, let composition events handle it
        if (isComposing) {
            return;
        }

        const target = e.target as HTMLElement;
        const currentText = target.textContent || '';

        // Case 1: Waiting for input after Unidentified keydown
        if (waitingForInput) {
            waitingForInput = false;

            const newChars = findNewCharacters(currentText, lastKnownContent);
            if (DEBUG_KEYBOARD_INPUT) console.log('[Input] Unidentified key chars:', newChars);

            if (newChars.length > 0 && !shouldSkipDuplicate(`unidentified:${newChars}`)) {
                sendTextChunked(newChars);
            }

            scheduleRestore();
            return;
        }

        // Case 2: beforeinput didn't fire
        if (!beforeInputFired) {
            const newChars = findNewCharacters(currentText, lastKnownContent);

            if (newChars.length > 0 && !shouldSkipDuplicate(`input:${newChars}`)) {
                sendTextChunked(newChars);
            }

            scheduleRestore();
            return;
        }

        // Case 3: Normal case - just restore
        scheduleRestore();
        beforeInputFired = false;
    });

    // ==================
    // PASTE
    // ==================
    toggleButton.addEventListener('paste', (e) => {
        if (!isRemoteKeyboardEnabled()) return;

        e.preventDefault();
        waitingForInput = false;
        resetCompositionState(true);

        const pastedText = e.clipboardData?.getData('text') || '';
        if (pastedText) {
            sendTextChunked(pastedText);
        }
    });

    // ==================
    // DROP
    // ==================
    toggleButton.addEventListener('drop', (e) => {
        if (!isRemoteKeyboardEnabled()) return;

        e.preventDefault();
        waitingForInput = false;
        resetCompositionState(true);

        const droppedText = e.dataTransfer?.getData('text') || '';
        if (droppedText) {
            sendTextChunked(droppedText);
            return;
        }
        scheduleRestore();
    });

    // ==================
    // FOCUS/BLUR
    // ==================
    toggleButton.addEventListener('blur', () => {
        if (pendingRestore !== null) {
            clearTimeout(pendingRestore);
            pendingRestore = null;
        }
        if (compositionTimeout !== null) {
            clearTimeout(compositionTimeout);
            compositionTimeout = null;
        }
        isComposing = false;
        lastCompositionText = '';
        waitingForInput = false;
        lastHandledKey = null;
        beforeInputFired = false;
        lastKnownContent = ICON;
        restoreButtonIcon();
    });

    toggleButton.addEventListener('focus', () => {
        lastHandledKey = null;
        lastHandledTime = 0;
        waitingForInput = false;
        beforeInputFired = false;
        isComposing = false;
        lastCompositionText = '';
        if (compositionTimeout !== null) {
            clearTimeout(compositionTimeout);
            compositionTimeout = null;
        }
        lastKnownContent = ICON;
        restoreButtonIcon();
    });

}

// Setup keyboard UI event handlers
export function setupKeyboardUIHandlers() {
    const keyboardElement = getKeyboardElement();
    if (!keyboardElement) return;

    const bindElementUi = !keyboardContainerUiBound.has(keyboardElement);
    if (bindElementUi) {
        keyboardContainerUiBound.add(keyboardElement);

        const closeBtn = keyboardElement.querySelector('.keyboard-close');
        closeBtn?.addEventListener('click', hideKeyboard);

        const tabs = keyboardElement.querySelectorAll('.keyboard-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const targetTab = tab.getAttribute('data-tab');
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');

                const panels = keyboardElement?.querySelectorAll('.keyboard-panel');
                panels?.forEach(panel => {
                    panel.classList.remove('active');
                    if (panel.getAttribute('data-panel') === targetTab) {
                        panel.classList.add('active');
                    }
                });
            });
        });

        const shiftBtn = keyboardElement.querySelector('.keyboard-shift');
        let isUpper = false;
        shiftBtn?.addEventListener('click', () => {
            isUpper = !isUpper;
            renderKeyboard(isUpper);
            shiftBtn.classList.toggle('active', isUpper);
        });

        const categoryBtns = keyboardElement.querySelectorAll('.emoji-category-btn');
        if (categoryBtns.length > 0) {
            const firstBtn = categoryBtns[0] as HTMLElement;
            firstBtn.classList.add('active');
            const firstCategory = firstBtn.getAttribute('data-category');
            if (firstCategory) {
                renderEmoji(firstCategory);
            }

            categoryBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    const category = btn.getAttribute('data-category');
                    if (category) {
                        categoryBtns.forEach(b => b.classList.remove('active'));
                        btn.classList.add('active');
                        renderEmoji(category);
                    }
                });
            });
        }

        keyboardElement.addEventListener('click', (e) => {
            if (e.target === keyboardElement) {
                hideKeyboard();
            }
        });
    }

    const doc = getAirpadOwnerDocument();
    if (!doc) return;

    teardownKeyboardDismissListeners();
    keyboardDismissAbort = new AbortController();
    const { signal } = keyboardDismissAbort;

    doc.addEventListener(
        'focusout',
        (e) => {
            if (!isRemoteKeyboardEnabled()) return;
            if (!isKeyboardVisible()) return;

            const fromEl = eventTargetElement(e);
            const rel = (e as FocusEvent).relatedTarget;
            const toEl = rel instanceof HTMLElement ? rel : null;

            const staysInInteractiveZone =
                isKeyboardStayOpenTarget(fromEl) || isKeyboardStayOpenTarget(toEl);

            if (!staysInInteractiveZone) hideKeyboard();
        },
        { signal },
    );

    // Single pointer path avoids double hideKeyboard (pointerdown + click) and races with DocTools.saveCoordinate.
    doc.addEventListener(
        'pointerdown',
        (e) => {
            if (!isRemoteKeyboardEnabled()) return;
            if (!isKeyboardVisible()) return;

            const el = eventTargetElement(e);
            if (!isKeyboardStayOpenTarget(el)) {
                hideKeyboard();
            }
        },
        { capture: false, passive: true, signal },
    );
}
