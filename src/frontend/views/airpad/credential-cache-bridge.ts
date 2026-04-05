/**
 * Breaks the static import cycle between config and websocket:
 * config calls invalidate; websocket registers the implementation once loaded.
 */

type InvalidateFn = () => void;

let impl: InvalidateFn | null = null;

/** Called from websocket.ts at module load. */
export function setAirpadCredentialInvalidator(fn: InvalidateFn): void {
    impl = fn;
}

/** Clear AES/HMAC key caches when transport secrets or mode change. */
export function invalidateAirpadTransportCredentials(): void {
    try {
        impl?.();
    } catch {
        // ignore
    }
}
