// =========================
// Keyboard UI Rendering
// =========================

import { EMOJI_CATEGORIES, KEYBOARD_LAYOUT, KEYBOARD_LAYOUT_UPPER } from './constants';
import { sendKeyboardChar } from './message';
import { getKeyboardElement, getToggleButton } from './state';

// Create keyboard HTML structure - hidden by default
export function createKeyboardHTML(): string {
    return `
        <div class="virtual-keyboard-container" data-hidden="true" aria-hidden="true">
            <div class="keyboard-header">
                <button type="button" name="airpad-keyboard-close" class="keyboard-close" aria-label="Close keyboard">✕</button>
                <div class="keyboard-tabs">
                    <button type="button" name="airpad-keyboard-tab-letters" class="keyboard-tab active" data-tab="letters">ABC</button>
                    <button type="button" name="airpad-keyboard-tab-emoji" class="keyboard-tab" data-tab="emoji">😀</button>
                </div>
            </div>
            <div class="keyboard-content">
                <div class="keyboard-panel active" data-panel="letters">
                    <div class="keyboard-shift-container">
                        <button type="button" name="airpad-keyboard-shift" class="keyboard-shift" data-shift="lower">⇧</button>
                    </div>
                    <div class="keyboard-rows" id="keyboardRows"></div>
                    <div class="keyboard-special">
                        <button class="keyboard-key special space" data-key=" ">Space</button>
                        <button class="keyboard-key special backspace" data-key="backspace">⌫</button>
                        <button class="keyboard-key special enter" data-key="enter">↵</button>
                    </div>
                </div>
                <div class="keyboard-panel" data-panel="emoji">
                    <div class="emoji-categories">
                        ${Object.keys(EMOJI_CATEGORIES).map(cat =>
                            `<button class="emoji-category-btn" data-category="${cat}">${cat}</button>`
                        ).join('')}
                    </div>
                    <div class="emoji-grid" id="emojiGrid"></div>
                </div>
            </div>
        </div>
    `;
}

// Render keyboard layout
export function renderKeyboard(isUpper: boolean = false) {
    const rowsEl = getKeyboardElement()?.querySelector('#keyboardRows');
    if (!rowsEl) return;

    rowsEl.innerHTML = '';
    const layout = isUpper ? KEYBOARD_LAYOUT_UPPER : KEYBOARD_LAYOUT;

    layout.forEach((row) => {
        const rowEl = document.createElement('div');
        rowEl.className = 'keyboard-row';
        row.forEach(key => {
            const keyEl = document.createElement('button');
            keyEl.className = 'keyboard-key';
            keyEl.textContent = key;
            keyEl.setAttribute('data-key', key);
            keyEl.addEventListener('click', () => handleKeyPress(key));
            rowEl.appendChild(keyEl);
        });
        rowsEl.appendChild(rowEl);
    });
}

// Render emoji grid
export function renderEmoji(category: string) {
    const gridEl = getKeyboardElement()?.querySelector('#emojiGrid');
    if (!gridEl) return;

    const emojis = EMOJI_CATEGORIES[category as keyof typeof EMOJI_CATEGORIES] || [];
    gridEl.innerHTML = '';

    emojis.forEach(emoji => {
        const emojiEl = document.createElement('button');
        emojiEl.className = 'emoji-key';
        emojiEl.textContent = emoji;
        emojiEl.setAttribute('data-emoji', emoji);
        emojiEl.addEventListener('click', () => handleKeyPress(emoji));
        gridEl.appendChild(emojiEl);
    });
}

// Handle key press
function handleKeyPress(key: string) {
    if (key === 'backspace') {
        sendKeyboardChar('\b');
    } else if (key === 'enter') {
        sendKeyboardChar('\n');
    } else {
        sendKeyboardChar(key);
    }
    // Reduced logging for better performance
    // log(`Keyboard: ${key === ' ' ? 'Space' : key === '\b' ? 'Backspace' : key === '\n' ? 'Enter' : key}`);
}

// Restore button icon
export function restoreButtonIcon() {
    const toggleButton = getToggleButton();
    if (!toggleButton) return;

    // Keep this path exception-safe: hideKeyboard() calls this frequently and
    // detached/focused state races can throw addRange errors in Chromium.
    toggleButton.textContent = '⌨️';

    if (!toggleButton.isConnected) return;
    const ownerDoc = toggleButton.ownerDocument;
    if (!ownerDoc) return;
    if (ownerDoc.activeElement !== toggleButton) return;

    const textNode = toggleButton.firstChild;
    const sel = globalThis?.getSelection?.();
    if (!(textNode instanceof Text) || !sel) return;

    try {
        const range = ownerDoc.createRange();
        range.setStart(textNode, Math.min(1, toggleButton.textContent?.length ?? 0));
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
    } catch {
        // ignore detached/selection races
    }
}

