import { H } from "fest/lure";
import { ViewerView } from "frontend/views/viewer";
import { UIPhosphorIcon } from "fest/icon";

export interface MarkdownEditorOptions {
    initialContent?: string;
    onContentChange?: (content: string) => void;
    onSave?: (content: string) => void;
    placeholder?: string;
    autoSave?: boolean;
    autoSaveDelay?: number;
}

export class MarkdownEditor {
    private options: MarkdownEditorOptions;
    private container: HTMLElement | null = null;
    private editor: HTMLTextAreaElement | null = null;
    private preview: any | null = null;
    private autoSaveTimeout: number | null = null;
    /** Coalesce live preview + stats so large docs do not parse/markdown on every keystroke. */
    private previewStatsDebounce: ReturnType<typeof setTimeout> | null = null;
    private static readonly PREVIEW_STATS_DEBOUNCE_MS = 160;

    constructor(options: MarkdownEditorOptions = {}) {
        this.options = {
            initialContent: "",
            placeholder: "Start writing your markdown here...",
            autoSave: true,
            autoSaveDelay: 1000,
            ...options
        };
    }

    /**
     * Render the markdown editor with live preview
     */
    render(): HTMLElement {
        this.container = H`<div class="markdown-editor-container">
      <div class="editor-header">
        <h3>Markdown Editor</h3>
        <div class="editor-actions">
          <button class="btn" data-action="clear">Clear</button>
          <button class="btn primary" data-action="save">Save</button>
        </div>
      </div>

      <div class="editor-layout">
        <div class="editor-panel">
          <div class="editor-toolbar">
            <div class="toolbar-group">
              <button class="btn small" data-action="bold" title="Bold">**bold**</button>
              <button class="btn small" data-action="italic" title="Italic">*italic*</button>
              <button class="btn small" data-action="code" title="Code">\`code\`</button>
            </div>
            <div class="toolbar-group">
              <button class="btn small" data-action="link" title="Link">[link](url)</button>
              <button class="btn small" data-action="image" title="Image">![alt](url)</button>
              <button class="btn small" data-action="list" title="List">- item</button>
            </div>
            <div class="toolbar-group">
              <button class="btn small" data-action="heading" title="Heading"># Heading</button>
              <button class="btn small" data-action="quote" title="Quote">> quote</button>
              <button class="btn small" data-action="codeblock" title="Code Block">\`\`\`</button>
            </div>
          </div>

          <textarea
            class="markdown-textarea"
            placeholder="${this.options.placeholder}"
            spellcheck="false"
          >${this.options.initialContent}</textarea>

          <div class="editor-footer">
            <div class="editor-stats">
              <span class="char-count">0 characters</span>
              <span class="word-count">0 words</span>
              <span class="line-count">0 lines</span>
            </div>
            <div class="editor-actions">
              <button class="btn small" data-action="print" title="Print content">
                <ui-icon icon="printer" size="16" icon-style="duotone"></ui-icon>
                Print
              </button>
              <button class="btn small" data-action="export-docx" title="Export as DOCX">
                <ui-icon icon="file-doc" size="16" icon-style="duotone"></ui-icon>
                DOCX
              </button>
            </div>
            <div class="editor-mode">
              <button class="btn small active" data-mode="edit">Edit</button>
              <button class="btn small" data-mode="preview">Preview</button>
              <button class="btn small" data-mode="split">Split</button>
            </div>
          </div>
        </div>

        <div class="preview-panel">
          <div class="preview-header">
            <h4>Live Preview</h4>
          </div>
          <div class="preview-content"></div>
        </div>
      </div>
    </div>` as HTMLElement;

        // Initialize components
        this.initializeEditor(this.container);

        return this.container;
    }

    /**
     * Get current content
     */
    getContent(): string {
        return this.editor?.value || "";
    }

    /**
     * Print current content
     */
    printContent(): void {
        const content = this.getContent();
        if (!content.trim()) {
            console.warn('[MarkdownEditor] No content to print');
            return;
        }

        try {
            // Get the rendered HTML content from preview
            const previewContent = this.container?.querySelector('.markdown-viewer-content') as HTMLElement;
            if (!previewContent) {
                console.error('[MarkdownEditor] Could not find preview content for printing');
                return;
            }

            // Try to use the server-side print route first
            const printUrl = new URL('/print', globalThis?.location?.origin);
            printUrl.searchParams.set('content', previewContent.innerHTML);
            printUrl.searchParams.set('title', 'Markdown Editor Content');

            // Open print URL in new window
            const printWindow = globalThis?.open(printUrl.toString(), '_blank', 'width=800,height=600');
            if (!printWindow) {
                console.warn('[MarkdownEditor] Failed to open print window - popup blocked?');
                // Fallback: trigger browser print dialog on current content
                this.printCurrentContent();
                return;
            }

            console.log('[MarkdownEditor] Print window opened successfully');
        } catch (error) {
            console.error('[MarkdownEditor] Error printing content:', error);
            // Fallback to current content printing
            this.printCurrentContent();
        }
    }

    async exportDocx(): Promise<void> {
        const content = this.getContent();
        if (!content.trim()) return;
        const { downloadMarkdownAsDocx } = await import("core/document/DocxExport");
        await downloadMarkdownAsDocx(content, {
            title: "Markdown Editor Content",
            filename: `markdown-editor-${new Date().toISOString().split('T')[0]}.docx`,
        });
    }

    /**
     * Print current content using browser's print dialog
     */
    private printCurrentContent(): void {
        // Add print styles to current content
        const previewContent = this.container?.querySelector('.markdown-viewer-content') as HTMLElement;
        if (previewContent) {
            previewContent.setAttribute('data-print', 'true');
            // Trigger print dialog
            globalThis?.print?.();
            // Remove print attribute after printing
            setTimeout(() => {
                previewContent.removeAttribute('data-print');
            }, 1000);
        }
    }

    /**
     * Set content
     */
    setContent(content: string): void {
        if (this.editor) {
            this.editor.value = content;
            if (this.previewStatsDebounce !== null) {
                globalThis.clearTimeout(this.previewStatsDebounce);
                this.previewStatsDebounce = null;
            }
            this.updatePreview();
            this.updateStats();
        }
    }

    /**
     * Focus the editor
     */
    focus(): void {
        this.editor?.focus();
    }

    /**
     * Clear the editor
     */
    clear(): void {
        this.setContent("");
        this.options.onContentChange?.("");
    }

    /**
     * Save the content
     */
    save(): void {
        const content = this.getContent();
        this.options.onSave?.(content);
    }

    private initializeEditor(container: HTMLElement): void {
        // Get elements
        this.editor = container.querySelector('.markdown-textarea') as HTMLTextAreaElement;
        const previewContainer = container.querySelector('.preview-content') as HTMLElement;

        // Create preview component using MarkdownViewer
        this.preview = new ViewerView({
            initialContent: ""
        });
        const previewElement = this.preview.render();
        previewContainer.append(previewElement);

        // Set up event listeners
        this.setupEventListeners(container);

        // Initial state
        this.updatePreview();
        this.updateStats();
    }

    private setupEventListeners(container: HTMLElement): void {
        if (!this.editor) return;

        // Content change events
        this.editor.addEventListener('input', () => {
            this.handleContentChange();
        });

        this.editor.addEventListener('change', () => {
            this.handleContentChange();
        });

        // Toolbar actions
        container.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const btn = target?.closest?.('[data-action]') as HTMLElement | null;
            const action = btn?.getAttribute('data-action');

            if (action) {
                e.preventDefault();
                this.handleToolbarAction(action);
            }
        });

        // Mode switching
        container.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const mode = target.getAttribute('data-mode');

            if (mode) {
                this.switchMode(mode);
            }
        });
    }

    private handleContentChange(): void {
        const content = this.getContent();
        this.options.onContentChange?.(content);

        // Auto-save
        if (this.options.autoSave) {
            this.scheduleAutoSave();
        }

        this.schedulePreviewAndStatsUpdate();
    }

    private schedulePreviewAndStatsUpdate(): void {
        if (this.previewStatsDebounce !== null) {
            globalThis.clearTimeout(this.previewStatsDebounce);
        }
        this.previewStatsDebounce = globalThis.setTimeout(() => {
            this.previewStatsDebounce = null;
            this.updatePreview();
            this.updateStats();
        }, MarkdownEditor.PREVIEW_STATS_DEBOUNCE_MS) as unknown as number;
    }

    private handleToolbarAction(action: string): void {
        const textarea = this.editor;
        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selectedText = textarea.value.substring(start, end);
        let replacement = '';

        switch (action) {
            case 'bold':
                replacement = selectedText ? `**${selectedText}**` : '**bold text**';
                break;
            case 'italic':
                replacement = selectedText ? `*${selectedText}*` : '*italic text*';
                break;
            case 'code':
                replacement = selectedText ? `\`${selectedText}\`` : '`code`';
                break;
            case 'link':
                replacement = selectedText ? `[${selectedText}](url)` : '[link text](url)';
                break;
            case 'image':
                replacement = selectedText ? `![${selectedText}](image-url)` : '![alt text](image-url)';
                break;
            case 'list':
                replacement = selectedText ? `- ${selectedText}` : '- list item';
                break;
            case 'heading':
                replacement = selectedText ? `# ${selectedText}` : '# Heading';
                break;
            case 'quote':
                replacement = selectedText ? `> ${selectedText}` : '> quote';
                break;
            case 'codeblock':
                replacement = selectedText ? `\`\`\`\n${selectedText}\n\`\`\`` : '```\ncode block\n```';
                break;
            case 'clear':
                this.clear();
                return;
            case 'save':
                this.save();
                return;
            case 'print':
                this.printContent();
                return;
            case 'export-docx':
                void this.exportDocx();
                return;
        }

        if (replacement) {
            this.insertText(replacement, start, end);
        }
    }

    private insertText(text: string, start?: number, end?: number): void {
        const textarea = this.editor;
        if (!textarea) return;

        const currentStart = start ?? textarea.selectionStart;
        const currentEnd = end ?? textarea.selectionEnd;

        textarea.setRangeText(text, currentStart, currentEnd, 'end');
        textarea.focus();

        // Trigger input event
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    private switchMode(mode: string): void {
        const container = this.editor?.closest('.markdown-editor-container');
        if (!container) return;

        const editorPanel = container.querySelector('.editor-panel') as HTMLElement;
        const previewPanel = container.querySelector('.preview-panel') as HTMLElement;
        const modeButtons = container.querySelectorAll('[data-mode]');

        // Reset active states
        modeButtons.forEach(btn => btn.classList.remove('active'));

        // Set active button
        const activeButton = container.querySelector(`[data-mode="${mode}"]`) as HTMLElement;
        activeButton?.classList.add('active');

        // Update layout
        switch (mode) {
            case 'edit':
                editorPanel.style.display = 'block';
                previewPanel.style.display = 'none';
                this.editor?.focus();
                break;
            case 'preview':
                editorPanel.style.display = 'none';
                previewPanel.style.display = 'block';
                break;
            case 'split':
                editorPanel.style.display = 'block';
                previewPanel.style.display = 'block';
                this.editor?.focus();
                break;
        }
    }

    private updatePreview(): void {
        if (this.preview && this.editor) {
            this.preview.setContent(this.editor.value);
        }
    }

    private updateStats(): void {
        const container = this.editor?.closest('.markdown-editor-container');
        if (!container || !this.editor) return;

        const content = this.editor.value;
        const charCount = content.length;
        const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
        const lineCount = content.split('\n').length;

        const charCountEl = container.querySelector('.char-count') as HTMLElement;
        const wordCountEl = container.querySelector('.word-count') as HTMLElement;
        const lineCountEl = container.querySelector('.line-count') as HTMLElement;

        if (charCountEl) charCountEl.textContent = `${charCount} characters`;
        if (wordCountEl) wordCountEl.textContent = `${wordCount} words`;
        if (lineCountEl) lineCountEl.textContent = `${lineCount} lines`;
    }

    private scheduleAutoSave(): void {
        if (this.autoSaveTimeout) {
            globalThis?.clearTimeout?.(this.autoSaveTimeout);
        }

        this.autoSaveTimeout = globalThis?.setTimeout?.(() => {
            this.save();
        }, this.options.autoSaveDelay) as any;
    }
}

/**
 * Create a markdown editor instance
 */
export function createMarkdownEditor(options?: MarkdownEditorOptions): MarkdownEditor {
    return new MarkdownEditor(options);
}