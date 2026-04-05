// =========================
// VirtualKeyboard API Management
// =========================

import { log } from '../../utils/utils';

let virtualKeyboardAPI: any = null;

// Check for VirtualKeyboard API support
export function initVirtualKeyboardAPI(): boolean {
    if ('virtualKeyboard' in navigator && (navigator as any).virtualKeyboard) {
        virtualKeyboardAPI = (navigator as any).virtualKeyboard;
        virtualKeyboardAPI.overlaysContent = true;
        log('VirtualKeyboard API available');
        return true;
    }
    return false;
}

// Get the VirtualKeyboard API instance
export function getVirtualKeyboardAPI(): any {
    return virtualKeyboardAPI;
}

// Check if VirtualKeyboard API is available
export function hasVirtualKeyboardAPI(): boolean {
    return virtualKeyboardAPI !== null;
}

