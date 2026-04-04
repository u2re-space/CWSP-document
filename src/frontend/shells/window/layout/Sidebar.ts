import { H, M, navigate } from "fest/lure";
import { NAVIGATION_SHORTCUTS } from "../../../../core/storage/StateStorage";
import { isPrimitive } from "fest/core";
import { scheduleFrame } from "@rs-core/utils/Runtime";

//
export const Sidebar: any = (currentView: { value: string }, entityViews, existsViews, _makeView: (key: string) => any) => {
    const fallbackLinks = NAVIGATION_SHORTCUTS.filter(({ view }) => !entityViews?.has?.(view));
    const sidebar = H`<nav slot="sidebar" class="sidebar c2-surface" aria-label="Primary" style="content-visibility: visible"><ul>
${M(fallbackLinks, (frag) => H`<li><a target="_self" href="#${frag.view}" data-name="${frag.view}"><ui-icon icon="${frag.icon}" style="pointer-events: none"></ui-icon><span>${frag.label}</span></a></li>`)}
${M(entityViews, (frag, name) => H`<li><a target="_self" href="#${name}" data-name="${name}"><ui-icon icon="${frag?.icon}" style="pointer-events: none"></ui-icon><span>${frag?.label}</span></a></li>`)}
</ul></nav>`;

    //
    const closeSidebar = () => {
        const host = sidebar?.matches?.("ui-box-with-sidebar, ui-tabbed-with-sidebar") ? sidebar as any : sidebar?.closest?.("ui-box-with-sidebar, ui-tabbed-with-sidebar") as any;
        if (host?.sidebarOpened) {
            host.sidebarOpened = false;
        }
    };

    // navigation wiring for ui-tabbed-box
    sidebar?.addEventListener?.("click", (ev: any) => {
        ev?.preventDefault?.();
        const a = ev?.target?.matches?.('a[data-name]') ? ev?.target : ev?.target?.closest?.('a[data-name]'); if (!a) return;
        const name = (a?.getAttribute?.('data-name')?.replace?.(/^#/, "") || "home")?.replace?.(/^#/, "");

        // reactive INP side effect avoid
        scheduleFrame(() => {
            const $currentView = isPrimitive(currentView) ? currentView : ((currentView as { value: string }) as any);
            const curView = ($currentView?.replace?.(/^#/, "") ?? ($currentView as { value: string })?.value)?.replace?.(/^#/, "");
            if (name && name != curView) {
                navigate(`#${name}`, existsViews.has(name));
            };
        });

        //
        closeSidebar();
    });

    //
    // Auto-register with back navigation when attached
    /*const tryRegister = () => {
        if (!sidebar?.isConnected) {
            requestAnimationFrame(tryRegister);
            return;
        }

        //
        const host = sidebar?.matches?.("ui-box-with-sidebar, ui-tabbed-with-sidebar") ? sidebar as any : sidebar?.closest?.("ui-box-with-sidebar, ui-tabbed-with-sidebar") as any;
        if (host && (host?.getProperty?.("sidebarOpened") ?? host?.sidebarOpened)) {
            // Prevent multiple registrations
            if ((host as any)._backUnreg) return;
            (host as any)._backUnreg = registerSidebar(host, host?.getProperty?.("sidebarOpened") ?? host?.sidebarOpened, () => {
                closeSidebar();
                // Optional: focus handling or other cleanup
                return true;
            });
        }
    };*/

    // Try to register
    //requestAnimationFrame(tryRegister);

    //
    return sidebar;
}
