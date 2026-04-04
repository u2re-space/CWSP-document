import { H } from "fest/lure";
import type { View, ViewOptions } from "@shells/types";

export interface PrintViewOptions extends ViewOptions {
    initialMarkdown?: string;
    title?: string;
    autoPrint?: boolean;
}

export class PrintView implements View {
    readonly id = "print";
    readonly name = "Print";

    render(options?: ViewOptions): HTMLElement {
        const printOptions = (options || {}) as PrintViewOptions;
        const text = String(printOptions.initialMarkdown || printOptions.initialData || "");
        return H`<section data-view="print"><pre>${text}</pre></section>` as HTMLElement;
    }
}

export function createPrintView(options?: PrintViewOptions): PrintView {
    return new PrintView();
}

export const createView = createPrintView;
export default createPrintView;
