import { H } from "fest/lure";
import type { WorkCenterState, WorkCenterDependencies } from "./WorkCenterState";
import type { WorkCenterFileOps } from "./WorkCenterFileOps";
import { ROUTE_HASHES } from '@rs-com/config/Names';

export class WorkCenterAttachments {
    private container: HTMLElement | null = null;
    private deps: WorkCenterDependencies;
    private fileOps: WorkCenterFileOps;
    private previewUrlCache = new WeakMap<File, string>();

    constructor(dependencies: WorkCenterDependencies, fileOps: WorkCenterFileOps) {
        this.deps = dependencies;
        this.fileOps = fileOps;
    }

    setContainer(container: HTMLElement | null): void {
        this.container = container;
    }

    // Main attachments section rendering
    renderAttachmentsSection(state: WorkCenterState): string {
        return `
            <div class="wc-attachments-section">
              <div class="file-attachment-area" data-file-drop-zone="" data-dropzone="">
                <div class="file-drop-zone" >
                  <div class="drop-zone-content">
                    <ui-icon icon="folder" size="4rem" icon-style="duotone" class="drop-icon"></ui-icon>
                    <div class="drop-text">Drop files here or click to select files</div>
                    <div class="drop-hint" data-drop-hint>Supports: Images, Documents, Text files, PDFs, URLs, Base64 data</div>
                  </div>
                </div>
                <div class="file-list" data-file-list></div>
                ${this.renderRecognizedStatus(state)}
              </div>
              <div class="wc-block-header wc-attachments-toolbar">
                <div class="file-stats">
                  <div class="file-counter" data-file-count>
                    <ui-icon icon="file" size="16" icon-style="duotone"></ui-icon>
                    <span class="count">${state.files.length}</span>
                    <span class="label">files attached</span>
                  </div>
                  ${state.recognizedData ? `
                    <div class="data-counter recognized">
                      <ui-icon icon="eye" size="16" icon-style="duotone"></ui-icon>
                      <span>Content recognized</span>
                    </div>
                  ` : ''}
                  ${state.processedData && state.processedData.length > 0 ? `
                    <div class="data-counter processed">
                      <ui-icon icon="cogs" size="16" icon-style="duotone"></ui-icon>
                      <span>${state.processedData.length} processing steps</span>
                    </div>
                  ` : ''}
                </div>
              </div>
            </div>
        `;
    }

    private renderRecognizedStatus(state: WorkCenterState): string {
        if (!state.recognizedData) return '';

        return `
            <div class="wc-recognized-status">
              <ui-icon icon="check-circle" size="16" icon-style="duotone" class="status-icon"></ui-icon>
              <span>Content recognized - ready for processing</span>
              <button class="btn small clear-recognized" data-action="clear-recognized">Clear</button>
            </div>
        `;
    }

    // File list management
    updateFileList(state: WorkCenterState): void {
        if (!this.container) return;
        const fileList = this.container.querySelector('[data-file-list]') as HTMLElement;
        if (!fileList) return;

        fileList.innerHTML = '';

        if (state.files.length === 0) {
            fileList.innerHTML = '<div class="wc-attachments-empty">No files attached</div>';
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

        const fileItem = H`<div class="file-item" data-file-index="${index}">
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
        removeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
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
            this.updateFileCounter(state);
            this.deps.onFilesChanged?.();
        }
    }

    // Drop zone functionality
    setupDropZone(state: WorkCenterState): void {
        if (!this.container) return;

        const dropZone = this.container.querySelector('[data-file-drop-zone]') as HTMLElement | null;
        if (!dropZone) return;
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.multiple = true;
        fileInput.accept = 'image/*,.pdf,.txt,.md,.json,.html,.css,.js,.ts';
        fileInput.style.display = 'none';
        this.container.append(fileInput);

        // Update drop hint based on current route
        this.updateDropHint();

        // Click to select files
        dropZone.addEventListener('click', (e) => {
            const target = e.target as HTMLElement | null;
            if (target?.closest('button, a, input, select, textarea, label, [data-remove], [data-open-md]')) {
                return;
            }
            fileInput.click();
        });

        // Drag and drop events
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });

        dropZone.addEventListener('dragleave', (e) => {
            // Only remove drag-over class if leaving the drop zone entirely
            const rect = dropZone.getBoundingClientRect();
            const x = e.clientX;
            const y = e.clientY;

            if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
                dropZone.classList.remove('drag-over');
            }
        });

        dropZone.addEventListener('drop', async (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');

            const dataTransfer = e.dataTransfer;
            if (!dataTransfer) return;

            let contentAdded = false;

            // Handle files
            const files = Array.from(dataTransfer.files || []);
            if (files.length > 0) {
                this.fileOps.addFilesFromInput(state, files as any);
                this.updateFileList(state);
                this.updateFileCounter(state);
                this.deps.onFilesChanged?.();
                contentAdded = true;
            }

            // Handle text content from drag
            if (!contentAdded && dataTransfer.types.includes('text/plain')) {
                try {
                    const textContent = dataTransfer.getData('text/plain');
                    if (textContent?.trim()) {
                        await this.fileOps.handleDroppedContent(state, textContent.trim(), 'text');
                        contentAdded = true;
                    }
                } catch (error) {
                    console.warn('[WorkCenter] Failed to get dragged text:', error);
                }
            }

            // Handle URLs from drag
            if (!contentAdded && dataTransfer.types.includes('text/uri-list')) {
                try {
                    const uriList = dataTransfer.getData('text/uri-list');
                    const urls = uriList.split('\n').filter(url => url.trim() && !url.startsWith('#'));
                    if (urls.length > 0) {
                        for (const url of urls) {
                            if (this.isValidUrl(url.trim())) {
                                await this.fileOps.handleDroppedContent(state, url.trim(), 'url');
                                break; // Only handle first valid URL
                            }
                        }
                        contentAdded = true;
                    }
                } catch (error) {
                    console.warn('[WorkCenter] Failed to get dragged URLs:', error);
                }
            }

            // Handle HTML content from drag
            if (!contentAdded && dataTransfer.types.includes('text/html')) {
                try {
                    const htmlContent = dataTransfer.getData('text/html');
                    if (htmlContent) {
                        // Extract text from HTML
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = htmlContent;
                        const extractedText = tempDiv.textContent || tempDiv.innerText || '';
                        if (extractedText.trim()) {
                            await this.fileOps.handleDroppedContent(state, extractedText.trim(), 'html');
                            contentAdded = true;
                        }
                    }
                } catch (error) {
                    console.warn('[WorkCenter] Failed to get dragged HTML:', error);
                }
            }
        });

        // File input change
        fileInput.addEventListener('change', async (e) => {
            const files = Array.from((e.target as HTMLInputElement).files || []);
            this.fileOps.addFilesFromInput(state, files as any);
            this.updateFileList(state);
            this.updateFileCounter(state);
            this.deps.onFilesChanged?.();

            // Auto-process text/markdown files if template is selected
            const textFiles = files.filter(f => f.type.startsWith('text/') || f.type === 'application/markdown' || f.name?.endsWith('.md') || f.name?.endsWith('.txt'));
            if (textFiles.length > 0 && state.selectedTemplate && state.selectedTemplate.trim()) {
                console.log('[WorkCenter] Auto-processing text/markdown files with template:', state.selectedTemplate);
                // Small delay to allow UI to update
                setTimeout(async () => {
                    // This will be handled by the actions module
                    this.deps.showMessage?.('Files attached and ready for processing');
                }, 100);
            }
        });
    }

    // Update file counter
    updateFileCounter(state: WorkCenterState): void {
        if (!this.container) return;
        const counter = this.container.querySelector('[data-file-count] .count') as HTMLElement;
        if (counter) {
            counter.textContent = state.files.length.toString();
        }
    }

    // Update data counters (recognized and processed)
    updateDataCounters(state: WorkCenterState): void {
        if (!this.container) return;

        // Update recognized data counter
        const recognizedCounter = this.container.querySelector('.data-counter.recognized') as HTMLElement;
        if (state.recognizedData) {
            if (!recognizedCounter) {
                // Add recognized counter if it doesn't exist
                const statsContainer = this.container.querySelector('.file-stats');
                if (statsContainer) {
                    const newCounter = H`<div class="data-counter recognized">
                        <ui-icon icon="eye" size="16" icon-style="duotone"></ui-icon>
                        <span>Content recognized</span>
                    </div>` as HTMLElement;
                    statsContainer.appendChild(newCounter);
                }
            }
        } else if (recognizedCounter) {
            recognizedCounter.remove();
        }

        // Update processed data counter
        const processedCounter = this.container.querySelector('.data-counter.processed') as HTMLElement;
        if (state.processedData && state.processedData.length > 0) {
            if (processedCounter) {
                const span = processedCounter.querySelector('span') as HTMLElement;
                if (span) {
                    span.textContent = `${state.processedData.length} processing steps`;
                }
            } else {
                // Add processed counter if it doesn't exist
                const statsContainer = this.container.querySelector('.file-stats');
                if (statsContainer) {
                    const newCounter = H`<div class="data-counter processed">
                        <ui-icon icon="cogs" size="16" icon-style="duotone"></ui-icon>
                        <span>${state.processedData.length} processing steps</span>
                    </div>` as HTMLElement;
                    statsContainer.appendChild(newCounter);
                }
            }
        } else if (processedCounter) {
            processedCounter.remove();
        }
    }

    // Clear all files
    clearAllFiles(state: WorkCenterState): void {
        // Revoke all preview URLs
        this.revokeAllPreviewUrls(state);
        state.files.length = 0;
        this.updateFileList(state);
        this.updateFileCounter(state);
        this.updateDataCounters(state);
        this.deps.onFilesChanged?.();
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
            // Minimaledition stores markdown in localStorage + state.markdown.
            try { localStorage.setItem("rs-markdown", md); } catch { /* ignore */ }
            try {
                if (this.deps?.state) {
                    this.deps.state.markdown = md;
                    this.deps.state.view = "markdown-viewer";
                }
            } catch { /* ignore */ }
            this.deps.render?.();
            // Defer toast/status updates so the view switch render completes first.
            setTimeout(() => {
                this.deps.showMessage?.(`Opened ${file.name || 'file'} in Markdown Viewer`);
            }, 0);
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

    private isValidUrl(string: string): boolean {
        try {
            new URL(string);
            return true;
        } catch {
            return false;
        }
    }

    updateDropHint(): void {
        if (!this.container) return;

        const hintElement = this.container.querySelector('[data-drop-hint]') as HTMLElement;
        if (!hintElement) return;

        const currentHash = globalThis?.location?.hash;

        switch (currentHash) {
            case ROUTE_HASHES.SHARE_TARGET_TEXT:
                hintElement.textContent = 'Drop text files or paste text content here';
                break;
            case ROUTE_HASHES.SHARE_TARGET_IMAGE:
                hintElement.textContent = 'Drop image files here (PNG, JPG, GIF, WebP, etc.)';
                break;
            case ROUTE_HASHES.SHARE_TARGET_FILES:
                hintElement.textContent = 'Drop any files here (images, documents, text files, PDFs, etc.)';
                break;
            case ROUTE_HASHES.SHARE_TARGET_URL:
                hintElement.textContent = 'Paste URLs here (file drops not accepted on this route)';
                break;
            default:
                hintElement.textContent = 'Supports: Images, Documents, Text files, PDFs, URLs, Base64 data';
                break;
        }
    }
}