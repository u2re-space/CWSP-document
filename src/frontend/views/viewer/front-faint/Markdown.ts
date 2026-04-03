import { H, provide } from "fest/lure";
import { createMarkdownViewer } from "fest/fl-ui";

// View
export const MakeMarkdownView = async (path: string, id: string) => {
    // Load content from path
    let content = "";
    try {
        if (path.startsWith("/user/") || path.startsWith("./") || path.startsWith("../")) {
            const file = await provide(path);
            if (file) {
                content = await file.text();
            }
        } else if (URL.canParse(path)) {
            const response = await fetch(path);
            content = await response.text();
        } else {
            content = path; // Direct content
        }
    } catch (error) {
        console.warn('[FaintMarkdown] Failed to load content:', error);
        content = `# Error loading content\n\nFailed to load: ${path}`;
    }

    // Create markdown viewer
    const viewer = createMarkdownViewer({
        content,
        showTitle: false,
        showActions: false
    });

    const viewElement = viewer.render();
    viewElement.style.cssText = "block-size: 100%; overflow: auto; display: block;";
    viewElement.classList.add("viewer-section");

    const section = H`<section id=${id} class="data-view c2-surface" style="grid-column: 2 / -1; grid-row: 2 / -1;">${viewElement}</section>`;
    return section;
}
