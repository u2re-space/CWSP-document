import type { WorkCenterState, WorkCenterDependencies } from "./WorkCenterState";
import { ROUTE_HASHES } from '@rs-com/config/Names';
import { normalizeDataAsset, parseDataUrl, isBase64Like } from 'fest/lure';

export class WorkCenterFileOps {
    private deps: WorkCenterDependencies;

    constructor(dependencies: WorkCenterDependencies) {
        this.deps = dependencies;
    }

    async handleDroppedContent(state: WorkCenterState, content: string, sourceType: string): Promise<void> {
        const currentHash = this.getCurrentHash();

        // Apply hash-specific drop rules
        switch (currentHash) {
            case ROUTE_HASHES.SHARE_TARGET_TEXT:
                // For text-specific route, only accept text content
                if (sourceType === 'text' || sourceType === 'html') {
                    return this.handlePastedContent(state, content, sourceType);
                } else {
                    this.deps.showMessage?.('This route only accepts text content. Please paste text or use the files route for file drops.');
                    return;
                }

            case ROUTE_HASHES.SHARE_TARGET_IMAGE:
                // For image-specific route, only accept image content
                if (this.isImageContent(content) || sourceType === 'image') {
                    return this.handleImageContent(state, content, sourceType);
                } else {
                    this.deps.showMessage?.('This route only accepts image content. Please drop images or use other routes for different content types.');
                    return;
                }

            case ROUTE_HASHES.SHARE_TARGET_FILES:
                // For files route, accept any file drops
                return this.handlePastedContent(state, content, sourceType);

            case ROUTE_HASHES.SHARE_TARGET_URL:
                // For URL route, only accept URLs
                if (this.isValidUrl(content)) {
                    return this.handlePastedContent(state, content, sourceType);
                } else {
                    this.deps.showMessage?.('This route only accepts URLs. Please paste a valid URL.');
                    return;
                }

            default:
                // Default behavior for regular workcenter
                return this.handlePastedContent(state, content, sourceType);
        }
    }

    async handlePastedContent(state: WorkCenterState, content: string, sourceType: string): Promise<void> {
        const currentHash = this.getCurrentHash();

        try {
            // Apply hash-specific paste rules
            switch (currentHash) {
                case ROUTE_HASHES.SHARE_TARGET_TEXT:
                    // Only accept text content for text route
                    if (sourceType === 'text' || sourceType === 'html') {
                        await this.handleTextContent(state, content, sourceType);
                    } else {
                        this.deps.showMessage?.('This route only accepts text content');
                    }
                    break;

                case ROUTE_HASHES.SHARE_TARGET_URL:
                    // Only accept URLs for URL route
                    if (this.isValidUrl(content)) {
                        await this.handleUrlContent(state, content);
                    } else {
                        this.deps.showMessage?.('This route only accepts valid URLs');
                    }
                    break;

                case ROUTE_HASHES.SHARE_TARGET_IMAGE:
                    // Only accept image content for image route
                    if (this.isImageContent(content) || this.isBase64Data(content)) {
                        await this.handleImageContent(state, content, sourceType);
                    } else {
                        this.deps.showMessage?.('This route only accepts image content');
                    }
                    break;

                default:
                    // Default behavior for regular workcenter and files route
                    await this.handleDefaultPaste(state, content, sourceType);
                    break;
            }
        } catch (error) {
            console.error('[WorkCenter] Failed to handle pasted content:', error);
            this.deps.showMessage?.('Failed to process pasted content');
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

    private isBase64Data(content: string): boolean {
        const raw = (content || '').trim();
        return !!parseDataUrl(raw) || isBase64Like(raw);
    }

    private async handleBase64Content(state: WorkCenterState, content: string): Promise<void> {
        try {
            const asset = await normalizeDataAsset(content, {
                namePrefix: 'pasted-data',
                uriComponent: true
            });
            state.files.push(asset.file);
            this.deps.showMessage?.('Encoded content decoded and added to work center');

        } catch (error) {
            console.error('[WorkCenter] Failed to decode base64 content:', error);
            // Fallback: treat as regular text
            const fallbackAsset = await normalizeDataAsset(content, {
                namePrefix: 'pasted-text',
                mimeType: 'text/plain;charset=utf-8'
            });
            state.files.push(fallbackAsset.file);

            this.deps.showMessage?.('Base64 content added as text to work center');
        }
    }

    addFilesFromInput(state: WorkCenterState, files: FileList): void {
        const fileArray = Array.from(files);
        const currentHash = this.getCurrentHash();

        // Apply hash-specific file filtering
        let filteredFiles: File[] = fileArray;

        switch (currentHash) {
            case ROUTE_HASHES.SHARE_TARGET_IMAGE:
                // Only accept image files for image route
                filteredFiles = fileArray.filter(file => file.type.startsWith('image/'));
                if (filteredFiles.length === 0) {
                    this.deps.showMessage?.('This route only accepts image files. Please drop images or use other routes for different file types.');
                    return;
                }
                break;

            case ROUTE_HASHES.SHARE_TARGET_TEXT:
                // For text route, only accept text-based files
                filteredFiles = fileArray.filter(file =>
                    file.type.startsWith('text/') ||
                    file.type === 'application/json' ||
                    file.type === 'application/xml' ||
                    file.name.toLowerCase().endsWith('.txt') ||
                    file.name.toLowerCase().endsWith('.md') ||
                    file.name.toLowerCase().endsWith('.json') ||
                    file.name.toLowerCase().endsWith('.xml')
                );
                if (filteredFiles.length === 0) {
                    this.deps.showMessage?.('This route only accepts text files. Please drop text files or use the files route for other file types.');
                    return;
                }
                break;

            case ROUTE_HASHES.SHARE_TARGET_FILES:
                // Accept any files for files route
                filteredFiles = fileArray;
                break;

            case ROUTE_HASHES.SHARE_TARGET_URL:
                // Don't accept files for URL route
                this.deps.showMessage?.('This route only accepts URLs. Please paste a URL instead of dropping files.');
                return;

            default:
                // Default behavior - accept any files
                filteredFiles = fileArray;
                break;
        }

        state.files.push(...filteredFiles);

        // Show appropriate message
        if (filteredFiles.length > 0) {
            const fileCount = filteredFiles.length;
            const fileWord = fileCount === 1 ? 'file' : 'files';
            this.deps.showMessage?.(`${fileCount} ${fileWord} added to work center`);
        }
    }

    removeFile(state: WorkCenterState, index: number): File | null {
        if (index >= 0 && index < state.files.length) {
            return state.files.splice(index, 1)[0];
        }
        return null;
    }

    clearAllFiles(state: WorkCenterState): File[] {
        const files = [...state.files];
        state.files.length = 0;
        return files;
    }

    getFilesForProcessing(state: WorkCenterState): File[] {
        return [...state.files];
    }

    hasFiles(state: WorkCenterState): boolean {
        return state.files.length > 0;
    }

    hasTextFiles(state: WorkCenterState): boolean {
        return state.files.some(f =>
            f.type.startsWith('text/') ||
            f.type === 'application/markdown' ||
            f.name?.endsWith('.md') ||
            f.name?.endsWith('.txt')
        );
    }

    determineRecognizedFormat(state: WorkCenterState): 'markdown' | 'html' | 'text' | 'json' | 'xml' | 'other' {
        const hasTextFile = this.hasTextFiles(state);
        if (!hasTextFile) {
            // For images and other files, default to markdown
            return 'markdown';
        } else {
            // For text files, we could potentially detect format from content
            // For now, default to markdown (can contain markdown)
            return 'markdown';
        }
    }

    validateFileForUpload(file: File): { valid: boolean; reason?: string } {
        // Check file size (limit to 50MB)
        const maxSize = 50 * 1024 * 1024;
        if (file.size > maxSize) {
            return { valid: false, reason: 'File too large (max 50MB)' };
        }

        // Check file type
        const allowedTypes = [
            'image/', 'text/', 'application/pdf', 'application/json',
            'application/markdown', 'application/xml'
        ];
        const isAllowed = allowedTypes.some(type =>
            file.type.startsWith(type) || file.name.toLowerCase().endsWith(type.replace('application/', '.'))
        );

        if (!isAllowed) {
            return { valid: false, reason: 'File type not supported' };
        }

        return { valid: true };
    }

    // ============================================================================
    // HASH-AWARE CONTENT HANDLING METHODS
    // ============================================================================

    private getCurrentHash(): string {
        return typeof globalThis !== 'undefined' ? globalThis?.location?.hash : '';
    }

    private async handleTextContent(state: WorkCenterState, content: string, sourceType: string): Promise<void> {
        const asset = await normalizeDataAsset(content, {
            namePrefix: sourceType === 'html' ? 'shared-html' : 'shared-text',
            mimeType: sourceType === 'html' ? 'text/html' : 'text/plain;charset=utf-8'
        });
        state.files.push(asset.file);
        this.deps.showMessage?.('Text content added to work center');
    }

    private async handleUrlContent(state: WorkCenterState, content: string): Promise<void> {
        const asset = await normalizeDataAsset(content, {
            namePrefix: 'shared-url',
            uriComponent: true
        });
        state.files.push(asset.file);
        this.deps.showMessage?.('URL added to work center');
    }

    private async handleImageContent(state: WorkCenterState, content: string, sourceType: string): Promise<void> {
        if (this.isBase64Data(content)) {
            await this.handleBase64Content(state, content);
        } else {
            // Handle as regular image file
            const asset = await normalizeDataAsset(content, {
                namePrefix: 'shared-image',
                mimeType: sourceType === 'image' ? 'image/png' : 'text/plain;charset=utf-8',
                uriComponent: true
            });
            state.files.push(asset.file);
            this.deps.showMessage?.('Image content added to work center');
        }
    }

    private async handleDefaultPaste(state: WorkCenterState, content: string, sourceType: string): Promise<void> {
        // Check if content is a URL
        if (this.isValidUrl(content)) {
            const asset = await normalizeDataAsset(content, {
                namePrefix: 'pasted-url',
                uriComponent: true
            });
            state.files.push(asset.file);
            this.deps.showMessage?.('URL added to work center');
        }
        // Check if content is base64 encoded data
        else if (this.isBase64Data(content)) {
            await this.handleBase64Content(state, content);
        }
        // Regular text content
        else {
            const asset = await normalizeDataAsset(content, {
                namePrefix: `pasted-${sourceType || 'text'}`,
                mimeType: sourceType === 'html' ? 'text/html' : 'text/plain;charset=utf-8'
            });
            state.files.push(asset.file);
            this.deps.showMessage?.(`${sourceType === 'html' ? 'HTML' : 'Text'} content added to work center`);
        }
    }

    private isImageContent(content: string): boolean {
        // Check if content looks like image data
        return content.startsWith('data:image/') ||
               /\.(jpg|jpeg|png|gif|bmp|webp|svg)$/i.test(content);
    }
}