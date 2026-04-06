/**
 * Semantic host for the Explorer file tree. Renders the standard shell layout
 * and a single <ui-file-manager> child (OPFS + virtual /assets).
 */
import "@fl-ui/items/explorer/FileManager";

const TAG = "cw-view-explorer";

export class CwViewExplorer extends HTMLElement {
    connectedCallback(): void {
        if (this.querySelector(".view-explorer")) return;
        const shell = document.createElement("div");
        shell.className = "view-explorer";
        const content = document.createElement("div");
        content.className = "view-explorer__content";
        content.setAttribute("data-explorer-content", "");
        const fm = document.createElement("ui-file-manager");
        fm.setAttribute("view-mode", "list");
        content.append(fm);
        shell.append(content);
        this.append(shell);
    }
}

export const ensureCwViewExplorerDefined = (): void => {
    if (!customElements.get(TAG)) {
        customElements.define(TAG, CwViewExplorer);
    }
};

export default CwViewExplorer;
