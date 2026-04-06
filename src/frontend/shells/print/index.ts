import type { View, ViewOptions } from "@shells/types";

export type PrintViewOptions = ViewOptions & {
    content?: string;
    title?: string;
};

export class PrintView implements View {
    id = "print" as const;
    name = "Print";
    icon = "printer";

    private options: PrintViewOptions;

    constructor(options: PrintViewOptions = {}) {
        this.options = options;
    }

    render(): HTMLElement {
        const root = document.createElement("section");
        root.className = "view-print";

        const heading = document.createElement("h1");
        heading.textContent = this.options.title || "Print Preview";

        const content = document.createElement("pre");
        content.className = "view-print__content";
        content.textContent = String(this.options.content || "");

        root.append(heading, content);
        return root;
    }
}

export function createPrintView(options?: PrintViewOptions): PrintView {
    return new PrintView(options);
}

export default createPrintView;
