/**
 * Single source for markdown viewer toolbar chrome (standalone + shadow/slot modes).
 */

import { H } from "fest/lure";

export function createViewerToolbar(): HTMLElement {
    return H`
        <div
            class="view-viewer__toolbar"
            data-viewer-toolbar
            role="toolbar"
            aria-label="Markdown document actions"
        >
            <div class="view-viewer__toolbar-left">
                <div class="view-viewer__toolbar-group" role="group" aria-label="Document">
                    <button class="view-viewer__btn" data-action="open" type="button" title="Open file">
                        <ui-icon class="view-viewer__toolbar-icon" icon="folder-open" icon-style="duotone" size="20" aria-hidden="true"></ui-icon>
                        <span>Open</span>
                    </button>
                    <button class="view-viewer__btn" data-action="paste" type="button" title="Paste from clipboard (mobile-friendly)" aria-label="Paste from clipboard">
                        <ui-icon class="view-viewer__toolbar-icon" icon="clipboard-text" icon-style="duotone" size="20" aria-hidden="true"></ui-icon>
                        <span>Paste</span>
                    </button>
                    <button class="view-viewer__btn" data-action="download" type="button" title="Download as markdown">
                        <ui-icon class="view-viewer__toolbar-icon" icon="download" icon-style="duotone" size="20" aria-hidden="true"></ui-icon>
                        <span>Download</span>
                    </button>
                </div>
                <div class="view-viewer__toolbar-group" role="group" aria-label="Source">
                    <button class="view-viewer__btn" data-action="toggle-raw" type="button" title="Toggle raw/rendered view">
                        <ui-icon class="view-viewer__toolbar-icon" icon="code" icon-style="duotone" size="20" aria-hidden="true"></ui-icon>
                        <span>Raw</span>
                    </button>
                    <button class="view-viewer__btn" data-action="copy" type="button" title="Copy raw content">
                        <ui-icon class="view-viewer__toolbar-icon" icon="copy" icon-style="duotone" size="20" aria-hidden="true"></ui-icon>
                        <span>Copy</span>
                    </button>
                </div>
            </div>
            <div class="view-viewer__toolbar-center"></div>
            <div class="view-viewer__toolbar-right">
                <div class="view-viewer__toolbar-group" role="group" aria-label="Output">
                    <button class="view-viewer__btn" data-action="toggle-outline" type="button" title="Show or hide document outline (headings)">
                        <ui-icon class="view-viewer__toolbar-icon" icon="list-bullets" icon-style="duotone" size="20" aria-hidden="true"></ui-icon>
                        <span>Outline</span>
                    </button>
                    <button class="view-viewer__btn" data-action="copy-rendered" type="button" title="Copy rendered text">
                        <ui-icon class="view-viewer__toolbar-icon" icon="text-t" icon-style="duotone" size="20" aria-hidden="true"></ui-icon>
                        <span>Copy text</span>
                    </button>
                    <button class="view-viewer__btn" data-action="export-docx" type="button" title="Export as DOCX">
                        <ui-icon class="view-viewer__toolbar-icon" icon="file-doc" icon-style="duotone" size="20" aria-hidden="true"></ui-icon>
                        <span>DOCX</span>
                    </button>
                    <button class="view-viewer__btn" data-action="print" type="button" title="Print content">
                        <ui-icon class="view-viewer__toolbar-icon" icon="printer" icon-style="duotone" size="20" aria-hidden="true"></ui-icon>
                        <span>Print</span>
                    </button>
                </div>
                <div class="view-viewer__toolbar-group" role="group" aria-label="Workspace">
                    <button class="view-viewer__btn" data-action="attach" type="button" title="Attach to Work Center">
                        <ui-icon class="view-viewer__toolbar-icon" icon="paperclip" icon-style="duotone" size="20" aria-hidden="true"></ui-icon>
                        <span>Attach</span>
                    </button>
                    <button class="view-viewer__btn" data-action="open-style-settings" type="button" title="Markdown styling, modules, plugins">
                        <ui-icon class="view-viewer__toolbar-icon" icon="paint-roller" icon-style="duotone" size="20" aria-hidden="true"></ui-icon>
                        <span>Style</span>
                    </button>
                </div>
            </div>
        </div>
    ` as HTMLElement;
}
