import { H } from "fest/lure";
import type { ShellId, ShellLayoutConfig } from "../types";
import { BaseShell } from "../base";
import { requestOpenViewInTarget } from "../../shared/view-api";

// @ts-ignore - SCSS import
import style from "./window.scss?inline";

type WindowGeometry = {
    x: number;
    y: number;
    width: number;
    height: number;
};

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max);

export class WindowShell extends BaseShell {
    override id: ShellId = "window";
    override name = "Window";

    override layout: ShellLayoutConfig = {
        hasSidebar: false,
        hasToolbar: false,
        hasTabs: false,
        supportsMultiView: false,
        supportsWindowing: true
    };

    private detachFns: Array<() => void> = [];
    private geometry: WindowGeometry = {
        x: 64,
        y: 48,
        width: 1080,
        height: 760
    };
    private previousWindowed: WindowGeometry | null = null;

    protected override createLayout(): HTMLElement {
        const root = H`
            <div class="app-shell app-shell--window" data-shell="window" data-shell-window-mode="windowed">
                <header class="app-shell__window-titlebar" data-shell-window-titlebar>
                    <div class="app-shell__window-title">CrossWord</div>
                    <div class="app-shell__window-controls" role="toolbar" aria-label="Window controls">
                        <button class="app-shell__window-btn" type="button" data-shell-win-action="minimize" title="Minimize">
                            <ui-icon icon="minus"></ui-icon>
                        </button>
                        <button class="app-shell__window-btn" type="button" data-shell-win-action="maximize" title="Maximize">
                            <ui-icon icon="arrows-out"></ui-icon>
                        </button>
                        <button class="app-shell__window-btn danger" type="button" data-shell-win-action="close" title="Close">
                            <ui-icon icon="x"></ui-icon>
                        </button>
                    </div>
                </header>
                <main class="app-shell__content app-shell__content--window" data-shell-content role="main"></main>
                <button class="app-shell__resize-handle" type="button" data-shell-resize-handle aria-label="Resize window"></button>
                <div class="app-shell__status" data-shell-status hidden aria-live="polite"></div>
            </div>
        ` as HTMLElement;

        this.setupWindowControls(root);
        this.setupWindowDragging(root);
        this.setupWindowResizing(root);
        this.applyGeometry(root);
        return root;
    }

    protected override getStylesheet(): string | null {
        return style;
    }

    override async mount(container: HTMLElement): Promise<void> {
        await super.mount(container);
        const onResize = () => {
            if (!this.rootElement) return;
            const shell = this.rootElement.querySelector<HTMLElement>(".app-shell");
            if (!shell) return;
            this.applyGeometry(shell);
        };
        globalThis.addEventListener?.("resize", onResize, { passive: true });
        this.detachFns.push(() => globalThis.removeEventListener?.("resize", onResize as EventListener));
    }

    override unmount(): void {
        for (const detach of this.detachFns.splice(0)) {
            try {
                detach();
            } catch {
                // no-op
            }
        }
        super.unmount();
    }

    private setWindowMode(root: HTMLElement, mode: "windowed" | "maximized"): void {
        if (mode === "maximized" && root.dataset.shellWindowMode !== "maximized") {
            this.previousWindowed = { ...this.geometry };
        }
        if (mode === "windowed" && this.previousWindowed) {
            this.geometry = { ...this.previousWindowed };
        }
        root.dataset.shellWindowMode = mode;
        this.applyGeometry(root);
        this.setActiveTaskState("active");
    }

    private applyGeometry(root: HTMLElement): void {
        if (root.dataset.shellWindowMode === "maximized") {
            root.style.removeProperty("--window-x");
            root.style.removeProperty("--window-y");
            root.style.removeProperty("--window-w");
            root.style.removeProperty("--window-h");
            return;
        }

        const vw = Math.max(globalThis.innerWidth || 0, 320);
        const vh = Math.max(globalThis.innerHeight || 0, 320);
        const minW = 420;
        const minH = 280;
        const maxW = Math.max(minW, vw - 24);
        const maxH = Math.max(minH, vh - 24);
        this.geometry.width = clamp(this.geometry.width, minW, maxW);
        this.geometry.height = clamp(this.geometry.height, minH, maxH);
        this.geometry.x = clamp(this.geometry.x, 8, Math.max(8, vw - this.geometry.width - 8));
        this.geometry.y = clamp(this.geometry.y, 8, Math.max(8, vh - this.geometry.height - 8));

        root.style.setProperty("--window-x", `${this.geometry.x}px`);
        root.style.setProperty("--window-y", `${this.geometry.y}px`);
        root.style.setProperty("--window-w", `${this.geometry.width}px`);
        root.style.setProperty("--window-h", `${this.geometry.height}px`);
    }

    private setupWindowControls(root: HTMLElement): void {
        const titlebar = root.querySelector<HTMLElement>("[data-shell-window-titlebar]");
        if (!titlebar) return;

        const onTitleClick = (event: Event) => {
            const target = event.target as HTMLElement | null;
            const action = target?.closest?.("[data-shell-win-action]")?.getAttribute?.("data-shell-win-action");
            if (!action) return;
            if (action === "minimize") {
                root.classList.add("is-minimized");
                setTimeout(() => root.classList.remove("is-minimized"), 220);
                this.setActiveTaskState("minimized");
                return;
            }
            if (action === "maximize") {
                const mode = root.dataset.shellWindowMode === "maximized" ? "windowed" : "maximized";
                this.setWindowMode(root, mode);
                return;
            }
            if (action === "close") {
                this.setActiveTaskState("background");
                requestOpenViewInTarget("home", { target: "shell" });
            }
        };

        const onTitleDblClick = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest?.("[data-shell-win-action]")) return;
            const mode = root.dataset.shellWindowMode === "maximized" ? "windowed" : "maximized";
            this.setWindowMode(root, mode);
        };

        titlebar.addEventListener("click", onTitleClick);
        titlebar.addEventListener("dblclick", onTitleDblClick);
        this.detachFns.push(() => titlebar.removeEventListener("click", onTitleClick));
        this.detachFns.push(() => titlebar.removeEventListener("dblclick", onTitleDblClick));
    }

    private setupWindowDragging(root: HTMLElement): void {
        const titlebar = root.querySelector<HTMLElement>("[data-shell-window-titlebar]");
        if (!titlebar) return;

        const onPointerDown = (event: PointerEvent) => {
            if (event.button !== 0) return;
            const target = event.target as HTMLElement | null;
            if (target?.closest?.("[data-shell-win-action]")) return;
            if (root.dataset.shellWindowMode === "maximized") return;

            const pointerId = event.pointerId;
            const startX = event.clientX;
            const startY = event.clientY;
            const baseX = this.geometry.x;
            const baseY = this.geometry.y;
            titlebar.setPointerCapture?.(pointerId);
            root.setAttribute("data-window-dragging", "true");
            root.style.willChange = "transform";
            event.preventDefault();

            const onMove = (moveEvent: PointerEvent) => {
                if (moveEvent.pointerId !== pointerId) return;
                const dx = moveEvent.clientX - startX;
                const dy = moveEvent.clientY - startY;
                this.geometry.x = baseX + dx;
                this.geometry.y = baseY + dy;
                this.applyGeometry(root);
            };
            const onEnd = (endEvent: PointerEvent) => {
                if (endEvent.pointerId !== pointerId) return;
                titlebar.releasePointerCapture?.(pointerId);
                root.removeAttribute("data-window-dragging");
                root.style.removeProperty("will-change");
                titlebar.removeEventListener("pointermove", onMove);
                titlebar.removeEventListener("pointerup", onEnd);
                titlebar.removeEventListener("pointercancel", onEnd);
            };

            titlebar.addEventListener("pointermove", onMove);
            titlebar.addEventListener("pointerup", onEnd);
            titlebar.addEventListener("pointercancel", onEnd);
        };

        titlebar.addEventListener("pointerdown", onPointerDown);
        this.detachFns.push(() => titlebar.removeEventListener("pointerdown", onPointerDown));
    }

    private setupWindowResizing(root: HTMLElement): void {
        const handle = root.querySelector<HTMLElement>("[data-shell-resize-handle]");
        if (!handle) return;

        const onPointerDown = (event: PointerEvent) => {
            if (event.button !== 0) return;
            if (root.dataset.shellWindowMode === "maximized") return;
            const pointerId = event.pointerId;
            const startX = event.clientX;
            const startY = event.clientY;
            const baseW = this.geometry.width;
            const baseH = this.geometry.height;
            handle.setPointerCapture?.(pointerId);
            root.setAttribute("data-window-resizing", "true");
            root.style.willChange = "width,height,transform";
            event.preventDefault();

            const onMove = (moveEvent: PointerEvent) => {
                if (moveEvent.pointerId !== pointerId) return;
                const dw = moveEvent.clientX - startX;
                const dh = moveEvent.clientY - startY;
                this.geometry.width = baseW + dw;
                this.geometry.height = baseH + dh;
                this.applyGeometry(root);
            };
            const onEnd = (endEvent: PointerEvent) => {
                if (endEvent.pointerId !== pointerId) return;
                handle.releasePointerCapture?.(pointerId);
                root.removeAttribute("data-window-resizing");
                root.style.removeProperty("will-change");
                handle.removeEventListener("pointermove", onMove);
                handle.removeEventListener("pointerup", onEnd);
                handle.removeEventListener("pointercancel", onEnd);
            };

            handle.addEventListener("pointermove", onMove);
            handle.addEventListener("pointerup", onEnd);
            handle.addEventListener("pointercancel", onEnd);
        };

        handle.addEventListener("pointerdown", onPointerDown);
        this.detachFns.push(() => handle.removeEventListener("pointerdown", onPointerDown));
    }
}

export function createShell(_container: HTMLElement): WindowShell {
    return new WindowShell();
}

export default createShell;
