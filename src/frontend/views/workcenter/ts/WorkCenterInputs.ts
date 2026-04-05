import { H } from "fest/lure";
import type { WorkCenterState, WorkCenterDependencies } from "./WorkCenterState";
import type { WorkCenterFileOps } from "./WorkCenterFileOps";
import type { WorkCenterTemplates } from "./WorkCenterTemplates";
import type { WorkCenterVoice } from "./WorkCenterVoice";

export class WorkCenterInputs {
    private container: HTMLElement | null = null;
    private deps: WorkCenterDependencies;
    private fileOps: WorkCenterFileOps;
    private templates: WorkCenterTemplates;
    private voice: WorkCenterVoice;
    private previewUrlCache = new WeakMap<File, string>();

    constructor(
        dependencies: WorkCenterDependencies,
        fileOps: WorkCenterFileOps,
        templates: WorkCenterTemplates,
        voice: WorkCenterVoice
    ) {
        this.deps = dependencies;
        this.fileOps = fileOps;
        this.templates = templates;
        this.voice = voice;
    }

    setContainer(container: HTMLElement | null): void {
        this.container = container;
    }

    // Main input section rendering (extracted from WorkCenterOld.ts lines 301-362)
    renderInputSection(state: WorkCenterState): string {
        return `
            <div class="prompt-section">
              <div class="wc-file-drop-overlay">
                  <div class="file-drop-zone">
                      <div class="drop-zone-content">
                      <ui-icon icon="folder" size="4rem" icon-style="duotone" class="drop-icon"></ui-icon>
                      <div class="drop-text">Drop files here or click to browse</div>
                      <div class="drop-hint">Supports: Images, Documents, Text files, PDFs</div>
                      </div>
                  </div>
                  <div class="file-list" data-file-list></div>
                ${this.renderRecognizedStatus(state)}
            </div>

                <div class="prompt-input-group" data-dropzone>
                  <div class="prompt-controls">
                    <select class="template-select">
                      <option value="">Select Template...</option>
                      ${state.promptTemplates.map(t => `<option value="${t.prompt.replace(/"/g, '&quot;')}" ${state.selectedTemplate === t.prompt ? 'selected' : ''}>${t.name}</option>`).join('')}
                    </select>
                    <button class="btn btn-icon" data-action="edit-templates" title="Edit Templates">
                      <ui-icon icon="gear" size="18" icon-style="duotone"></ui-icon>
                      <span class="btn-text">Templates</span>
                    </button>
                    <button class="btn btn-icon" data-action="select-files" title="Choose Files">
                      <ui-icon icon="folder-open" size="18" icon-style="duotone"></ui-icon>
                      <span class="btn-text">Files</span>
                    </button>
                  </div>
                  <div class="instruction-selector-row">
                    <label class="instruction-label">
                      <ui-icon icon="clipboard-text" size="16" icon-style="duotone"></ui-icon>
                      <span>Instruction:</span>
                    </label>
                    <select class="instruction-select" data-action="select-instruction">
                      <option value="">None (default)</option>
                    </select>
                    <button class="btn btn-icon btn-sm" data-action="refresh-instructions" title="Refresh from Settings">
                      <ui-icon icon="arrows-clockwise" size="14" icon-style="duotone"></ui-icon>
                    </button>
                  </div>
                  <textarea
                    class="prompt-input"
                    placeholder="Describe what you want to do with the content... (or use voice input)"
                    rows="3"
                  >${state.currentPrompt}</textarea>
                  <div class="prompt-actions">
                    <button class="btn voice-btn ${state.voiceRecording ? 'recording' : ''}" data-action="voice-input">
                      🎤 ${state.voiceRecording ? 'Recording...' : 'Hold for Voice'}
                    </button>
                    <button class="btn clear-btn" data-action="clear-prompt">Clear</button>
                  </div>
                </div>
              </div>

              <div class="action-section">
                <div class="action-controls">
                  <div class="action-buttons">
                    <button class="btn primary action-btn" data-action="execute">
                      <ui-icon icon="brain" size="20" icon-style="duotone"></ui-icon>
                      <span class="btn-text">Recognize & Take Action</span>
                    </button>
                  </div>
                  <label class="auto-action-label" title="Auto-action (use last successful)">
                    <input type="checkbox" class="auto-action-checkbox" ${state.autoAction ? 'checked' : ''}>
                    <ui-icon icon="lightning-a" size="20" icon-style="duotone"></ui-icon>
                  </label>
                </div>
              </div>
        `;
    }

    private renderRecognizedStatus(state: WorkCenterState): string {
        if (!state.recognizedData) return '';

        return `
            <div class="wc-recognized-status">
              <ui-icon icon="check-circle" size="16" icon-style="duotone" class="status-icon"></ui-icon>
              <span>Content recognized - ready for actions</span>
              <button class="btn small clear-recognized" data-action="clear-recognized">Clear</button>
            </div>
        `;
    }

    // File list management (extracted from WorkCenterOld.ts)
    updateFileList(state: WorkCenterState): void {
        if (!this.container) return;
        const fileList = this.container.querySelector('[data-file-list]') as HTMLElement;
        if (!fileList) return;

        fileList.innerHTML = '';

        if (state.files.length === 0) {
            fileList.innerHTML = '<div class="wc-attachments-empty">No files selected</div>';
            return;
        }

        state.files.forEach((file, index) => {
            const fileItem = this.createFileItem(file, index, state);
            fileList.append(fileItem);
        });
    }

    private createFileItem(file: File, index: number, state: WorkCenterState): HTMLElement {
        const isImage = this.isImageFile(file);
        const isMarkdown = this.isMarkdownFile(file);
        const previewUrl = isImage ? this.getOrCreatePreviewUrl(file) : null;
        const fileSize = this.formatFileSize(file.size);

        const fileItem = H`<div class="file-item">
      <div class="file-info">
        <span class="file-icon">${this.createFileIconElement(file.type)}</span>
        ${previewUrl ? H`<img class="file-preview" alt=${file.name || "image"} src=${previewUrl} loading="lazy" decoding="async" />` : ''}
        <div class="file-details">
          <span class="file-name">${file.name || 'Unnamed file'}</span>
          <span class="file-size">(${fileSize})</span>
          <span class="file-type">${this.getReadableFileType(file.type)}</span>
        </div>
        ${isMarkdown ? H`<button class="btn small" data-open-md="${index}" title="Open in Markdown Viewer">Open</button>` : ''}
      </div>
      <button class="btn small remove-btn" data-remove="${index}" title="Remove file">✕</button>
    </div>` as HTMLElement;

        // Add event listeners
        const openBtn = fileItem.querySelector(`[data-open-md="${index}"]`) as HTMLButtonElement | null;
        if (openBtn) {
            openBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                await this.openMarkdownInViewer(file);
            });
        }

        const removeBtn = fileItem.querySelector('.remove-btn') as HTMLButtonElement;
        removeBtn.addEventListener('click', () => {
            this.removeFile(state, index);
        });

        return fileItem;
    }

    private removeFile(state: WorkCenterState, index: number): void {
        const removedFile = state.files[index];
        if (removedFile) {
            this.revokePreviewUrl(removedFile);
            state.files.splice(index, 1);
            this.updateFileList(state);
            this.deps.onFilesChanged?.();
        }
    }

    // Drop zone functionality
    setupDropZone(state: WorkCenterState): void {
        if (!this.container) return;

        const dropZone = this.container.querySelector('[data-dropzone]') as HTMLElement;
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.multiple = true;
        fileInput.accept = 'image/*,.pdf,.txt,.md,.json,.html,.css,.js,.ts';
        fileInput.style.display = 'none';
        this.container.append(fileInput);

        // Click to select files
        dropZone.addEventListener('click', () => fileInput.click());

        // File input change
        fileInput.addEventListener('change', async (e) => {
            const files = Array.from((e.target as HTMLInputElement).files || []);
            this.fileOps.addFilesFromInput(state, files as any);
            this.updateFileList(state);
            this.deps.onFilesChanged?.();

            // Auto-process text/markdown files if template is selected
            const textFiles = files.filter(f => f.type.startsWith('text/') || f.type === 'application/markdown' || f.name?.endsWith('.md') || f.name?.endsWith('.txt'));
            if (textFiles.length > 0 && state.selectedTemplate && state.selectedTemplate.trim()) {
                console.log('[WorkCenter] Auto-processing text/markdown files with template:', state.selectedTemplate);
                // Small delay to allow UI to update
                setTimeout(async () => {
                    // This will be handled by the actions module
                    this.deps.showMessage?.('Files added and ready for processing');
                }, 100);
            }
        });
    }

    // Update methods for various UI elements
    updatePromptInput(state: WorkCenterState): void {
        if (!this.container) return;
        const promptInput = this.container.querySelector('.prompt-input') as HTMLTextAreaElement;
        if (promptInput) {
            promptInput.value = state.currentPrompt;
        }
    }

    updateTemplateSelect(state: WorkCenterState): void {
        if (!this.container) return;
        const templateSelect = this.container.querySelector('.template-select') as HTMLSelectElement;
        const currentValue = templateSelect.value;

        templateSelect.innerHTML = '<option value="">Select Template...</option>' +
            state.promptTemplates.map(t =>
                `<option value="${t.prompt.replace(/"/g, '&quot;')}" ${state.selectedTemplate === t.prompt ? 'selected' : ''}>${t.name}</option>`
            ).join('');

        // Restore the selected value if it still exists, otherwise keep current
        if (state.selectedTemplate && state.promptTemplates.some(t => t.prompt === state.selectedTemplate)) {
            templateSelect.value = state.selectedTemplate;
        } else {
            templateSelect.value = currentValue;
        }
    }

    updateVoiceButton(state: WorkCenterState): void {
        if (!this.container) return;
        const voiceBtn = this.container.querySelector('[data-action="voice-input"]') as HTMLButtonElement;
        if (voiceBtn) {
            voiceBtn.textContent = state.voiceRecording ? '🎤 Recording...' : '🎤 Hold for Voice';
            voiceBtn.classList.toggle('recording', state.voiceRecording);
        }
    }

    // Helper methods
    private isImageFile(file: File): boolean {
        const type = (file?.type || "").toLowerCase();
        return type.startsWith("image/");
    }

    private isMarkdownFile(file: File): boolean {
        const name = (file?.name || "").toLowerCase();
        const type = (file?.type || "").toLowerCase();
        return type === "text/markdown" || name.endsWith(".md") || name.endsWith(".markdown") || name.endsWith(".mdown") || name.endsWith(".mkd") || name.endsWith(".mkdn");
    }

    private getOrCreatePreviewUrl(file: File): string | null {
        if (!file) return null;
        if (!this.isImageFile(file)) return null;
        const cached = this.previewUrlCache.get(file);
        if (cached) return cached;
        try {
            const url = URL.createObjectURL(file);
            this.previewUrlCache.set(file, url);
            return url;
        } catch {
            return null;
        }
    }

    private revokePreviewUrl(file: File): void {
        const url = this.previewUrlCache.get(file);
        if (url) {
            try { URL.revokeObjectURL(url); } catch { /* ignore */ }
        }
        this.previewUrlCache.delete(file);
    }

    private async openMarkdownInViewer(file: File): Promise<void> {
        try {
            const md = await file.text();
            try { localStorage.setItem("rs-markdown", md); } catch { /* ignore */ }
            try {
                if (this.deps?.state) {
                    this.deps.state.markdown = md;
                    this.deps.state.view = "markdown-viewer";
                }
            } catch { /* ignore */ }
            this.deps.showMessage?.(`Opened ${file.name || 'file'} in Markdown Viewer`);
            this.deps.render?.();
        } catch (e) {
            this.deps.showMessage?.(`Failed to open ${file.name || 'file'}`);
            console.warn("[WorkCenter] Failed to open markdown file:", e);
        }
    }

    private createFileIconElement(mimeType: string): HTMLElement {
        const iconName = this.getFileIconName(mimeType);
        return H`<ui-icon icon="${iconName}" size="20" icon-style="duotone" class="file-type-icon"></ui-icon>` as HTMLElement;
    }

    private getFileIconName(mimeType: string): string {
        if (mimeType.startsWith('image/')) return 'image';
        if (mimeType === 'application/pdf') return 'file-pdf';
        if (mimeType.includes('json')) return 'file-text';
        if (mimeType.includes('text') || mimeType.includes('markdown')) return 'file-text';
        return 'file';
    }

    private getReadableFileType(mimeType: string): string {
        if (!mimeType) return 'Unknown';

        const typeMap: Record<string, string> = {
            'image/jpeg': 'JPEG Image',
            'image/png': 'PNG Image',
            'image/gif': 'GIF Image',
            'image/webp': 'WebP Image',
            'image/svg+xml': 'SVG Image',
            'application/pdf': 'PDF Document',
            'text/plain': 'Text File',
            'text/markdown': 'Markdown',
            'application/json': 'JSON',
            'text/html': 'HTML',
            'text/css': 'CSS',
            'application/javascript': 'JavaScript',
            'application/typescript': 'TypeScript'
        };

        // Check for exact matches first
        if (typeMap[mimeType]) return typeMap[mimeType];

        // Check for category matches
        if (mimeType.startsWith('image/')) return 'Image';
        if (mimeType.startsWith('text/')) return 'Text File';
        if (mimeType.startsWith('application/')) return 'Document';

        return mimeType.split('/')[1]?.toUpperCase() || 'File';
    }

    private formatFileSize(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    revokeAllPreviewUrls(state: WorkCenterState): void {
        try {
            for (const f of state.files) {
                this.revokePreviewUrl(f);
            }
        } catch {
            // ignore
        }
    }

    clearAllFiles(state: WorkCenterState): void {
        // Revoke all preview URLs
        this.revokeAllPreviewUrls(state);
        state.files.length = 0;
        this.updateFileList(state);
        this.deps.onFilesChanged?.();
    }
}