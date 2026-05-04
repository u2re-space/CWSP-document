/**
 * Root `index.html` entry — wires `#app` to the main frontend loader (`src/index.ts`).
 * NOTE: Path is fixed in `/index.html` as `/src/frontend/boot/html-boot.ts`.
 */

import index from "../../index";

const mount = (): void => {
    const el = document.getElementById("app");
    if (!el) {
        console.error("[html-boot] Missing #app mount element");
        return;
    }
    void index(el);
};

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
    mount();
}
