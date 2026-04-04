import type { WorkCenterState, WorkCenterDependencies } from "./WorkCenterState";
import type { WorkCenterUI } from "./WorkCenterUI";
import type { WorkCenterFileOps } from "./WorkCenterFileOps";
import type { WorkCenterActions } from "./WorkCenterActions";
import type { WorkCenterTemplates } from "./WorkCenterTemplates";
import type { WorkCenterVoice } from "./WorkCenterVoice";
import type { WorkCenterShareTarget } from "./WorkCenterShareTarget";
import type { WorkCenterHistory } from "./WorkCenterHistory";
import type { WorkCenterAttachments } from "./WorkCenterAttachments";
import type { WorkCenterPrompts } from "./WorkCenterPrompts";

export class WorkCenterEvents {
    private deps: WorkCenterDependencies;
    private ui: WorkCenterUI;
    private fileOps: WorkCenterFileOps;
    private actions: WorkCenterActions;
    private templates: WorkCenterTemplates;
    private voice: WorkCenterVoice;
    private shareTarget: WorkCenterShareTarget;
    private history: WorkCenterHistory;
    private attachments: WorkCenterAttachments;
    private prompts: WorkCenterPrompts;
    private state: WorkCenterState;
    private container: HTMLElement | null = null;
    private isHandlingPaste = false;

    constructor(
        dependencies: WorkCenterDependencies,
        ui: WorkCenterUI,
        fileOps: WorkCenterFileOps,
        actions: WorkCenterActions,
        templates: WorkCenterTemplates,
        voice: WorkCenterVoice,
        shareTarget: WorkCenterShareTarget,
        history: WorkCenterHistory,
        attachments: WorkCenterAttachments,
        prompts: WorkCenterPrompts,
        state: WorkCenterState
    ) {
        this.deps = dependencies;
        this.ui = ui;
        this.fileOps = fileOps;
        this.actions = actions;
        this.templates = templates;
        this.voice = voice;
        this.shareTarget = shareTarget;
        this.history = history;
        this.attachments = attachments;
        this.prompts = prompts;
        this.state = state;
    }

    setContainer(container: HTMLElement): void {
        this.container = container;
    }

    setupWorkCenterEvents(): void {
        if (!this.container) return;

        // File selection
        this.setupFileSelection();

        // Paste support
        this.setupPasteSupport();

        // Template selection
        this.setupTemplateSelection();

        // Instruction selection (from CustomInstructions in Settings)
        this.setupInstructionSelection();

        // Prompt input
        this.setupPromptInput();
        this.setupPromptDropzone();

        // Voice input
        this.setupVoiceInput();

        // Input tabs
        this.setupInputTabs();
        this.setupResultsTabs();
        this.setupHeaderControlsOverlay();

        // Format selectors
        this.setupFormatSelectors();

        // Auto action checkbox
        this.setupAutoActionCheckbox();

        // Action buttons and other click handlers
        this.setupActionButtons();

        // Pipeline step restoration
        this.setupPipelineRestoration();
    }

    private setupFileSelection(): void {
        if (!this.container) return;

        const fileSelectBtns = Array.from(this.container.querySelectorAll('[data-action="select-files"]')) as HTMLButtonElement[];
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.multiple = true;
        fileInput.accept = 'image/*,.pdf,.txt,.md,.json,.html,.css,.js,.ts';
        fileInput.style.display = 'none';
        this.container.append(fileInput);

        for (const btn of fileSelectBtns) {
            btn.addEventListener('click', () => fileInput.click());
        }
        fileInput.addEventListener('change', async (e) => {
            const files = Array.from((e.target as HTMLInputElement).files || []);
            this.fileOps.addFilesFromInput(this.state, files as any);
            this.ui.updateFileList(this.state);
            this.ui.updateFileCounter(this.state);
            this.deps.onFilesChanged?.();

            // Auto-process text/markdown files if template is selected
            const textFiles = files.filter(f => f.type.startsWith('text/') || f.type === 'application/markdown' || f.name.endsWith('.md') || f.name.endsWith('.txt'));
            if (textFiles.length > 0 && this.state.selectedTemplate && this.state.selectedTemplate.trim()) {
                console.log('[WorkCenter] Auto-processing text/markdown files with template:', this.state.selectedTemplate);
                // Small delay to allow UI to update
                setTimeout(async () => {
                    await this.actions.executeUnifiedAction(this.state);
                }, 100);
            }
        });
    }


    private setupPasteSupport(): void {
        if (!this.container) return;

        this.container.addEventListener('paste', async (e) => {
            if (this.isHandlingPaste) return;
            if (!e.clipboardData) return;
            const target = e.target as EventTarget | null;
            const isEditableTarget = this.isEditableTarget(target);
            const hasClipboardFiles = this.hasClipboardFiles(e.clipboardData);

            // Let native paste work in inputs/textareas/contenteditable when clipboard contains text only.
            // This prevents prompt input text from being misrouted into attachment handling.
            if (isEditableTarget && !hasClipboardFiles) {
                return;
            }

            let contentAdded = false;
            this.isHandlingPaste = true;
            try {

                // Handle clipboard file/blob items first (covers copied files/images from OS and apps).
                const itemFiles: File[] = [];
                for (const item of Array.from(e.clipboardData.items || [])) {
                    if (item.kind !== 'file' || !item.getAsFile) continue;
                    const file = item.getAsFile();
                    if (file) itemFiles.push(file);
                }

                if (itemFiles.length > 0) {
                    e.preventDefault();
                    this.fileOps.addFilesFromInput(this.state, itemFiles as any);
                    this.ui.updateFileList(this.state);
                    this.ui.updateFileCounter(this.state);
                    this.deps.onFilesChanged?.();
                    contentAdded = true;
                }

                // Handle clipboardData.files fallback.
                if (!contentAdded) {
                    const files = Array.from(e.clipboardData.files || []);
                    if (files.length > 0) {
                        e.preventDefault();
                        this.fileOps.addFilesFromInput(this.state, files as any);
                        this.ui.updateFileList(this.state);
                        this.ui.updateFileCounter(this.state);
                        this.deps.onFilesChanged?.();
                        contentAdded = true;
                    }
                }

                // Handle text content only when no files/blobs were found.
                if (!contentAdded) {
                    const textContent = e.clipboardData.getData('text/plain')?.trim();
                    if (textContent) {
                        e.preventDefault();
                        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
                        await this.fileOps.handlePastedContent(this.state, textContent, 'text');
                        contentAdded = true;
                    }
                }

                // Handle HTML content (extract text if no plain text/files).
                if (!contentAdded) {
                    const htmlContent = e.clipboardData.getData('text/html');
                    if (htmlContent) {
                        e.preventDefault();
                        const tempDiv = document.createElement('div');
                        tempDiv.innerHTML = htmlContent;
                        const extractedText = tempDiv.textContent || tempDiv.innerText || '';
                        if (extractedText.trim()) {
                            await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
                            await this.fileOps.handlePastedContent(this.state, extractedText.trim(), 'html');
                            contentAdded = true;
                        }
                    }
                }

                if (!contentAdded) {
                    e.preventDefault();
                    this.deps.showMessage?.('Clipboard content detected but no supported payload was extracted');
                }
            } finally {
                this.isHandlingPaste = false;
            }
        });
    }

    private isEditableTarget(target: EventTarget | null): boolean {
        if (!(target instanceof HTMLElement)) return false;
        if (target.isContentEditable) return true;
        if (target.closest('[contenteditable="true"]')) return true;
        return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    }

    private hasClipboardFiles(clipboardData: DataTransfer): boolean {
        if ((clipboardData.files || []).length > 0) return true;
        return Array.from(clipboardData.items || []).some((item) => item.kind === 'file');
    }

    private setupTemplateSelection(): void {
        if (!this.container) return;

        const templateSelect = this.container.querySelector('.template-select') as HTMLSelectElement;
        templateSelect?.addEventListener('change', async () => {
            const selectedPrompt = templateSelect.value;
            this.templates.selectTemplate(this.state, selectedPrompt);

            // Always apply the selected template - templates are meant to provide structured prompts
            // Users can modify them after selection if needed
            if (selectedPrompt) {
                this.prompts.updatePromptInput(this.state);

                // Auto-process if we have recognized data or files
                if (this.state.recognizedData || this.fileOps.hasFiles(this.state)) {
                    console.log('[WorkCenter] Auto-processing with selected template:', selectedPrompt);
                    await this.actions.executeUnifiedAction(this.state);
                }
            }
            const { WorkCenterStateManager } = await import('./WorkCenterState');
            WorkCenterStateManager.saveState(this.state);
        });
    }

    private setupInstructionSelection(): void {
        if (!this.container) return;

        // Populate the instruction selector from CustomInstructions in settings
        void this.prompts.populateInstructionSelect(this.state).then(async () => {
            const { WorkCenterStateManager } = await import('./WorkCenterState');
            WorkCenterStateManager.saveState(this.state);
        });

        const instructionSelect = this.container.querySelector('.instruction-select') as HTMLSelectElement;
        instructionSelect?.addEventListener('change', async () => {
            const selectedId = instructionSelect.value;
            this.prompts.handleInstructionSelection(this.state, selectedId);
            await this.templates.setActiveInstruction(selectedId || null);
            const { WorkCenterStateManager } = await import('./WorkCenterState');
            WorkCenterStateManager.saveState(this.state);
        });
    }

    private setupPromptInput(): void {
        if (!this.container) return;

        const promptInput = this.container.querySelector('.prompt-input') as HTMLTextAreaElement;
        if (!promptInput) return;
        promptInput.addEventListener('input', async () => {
            this.state.currentPrompt = promptInput.value;
            const { WorkCenterStateManager } = await import('./WorkCenterState');
            WorkCenterStateManager.saveState(this.state);

            // Auto-process if we have recognized data and user entered text
            if (this.state.recognizedData && promptInput.value.trim()) {
                console.log('[WorkCenter] Auto-processing recognized data with manual prompt');
                // Debounce auto-processing
                clearTimeout((this.container as any)._autoProcessTimeout);
                (this.container as any)._autoProcessTimeout = setTimeout(async () => {
                    await this.actions.executeUnifiedAction(this.state);
                }, 1000); // 1 second delay
            }
        });
    }

    private setupVoiceInput(): void {
        if (!this.container) return;

        const voiceBtn = this.container.querySelector('[data-action="voice-input"]') as HTMLButtonElement;
        if (!voiceBtn) return;
        voiceBtn.addEventListener('mousedown', () => this.voice.startVoiceRecording(this.state));
        voiceBtn.addEventListener('mouseup', () => {
            this.voice.stopVoiceRecording(this.state);
            this.ui.updateVoiceButton(this.state);
        });
        voiceBtn.addEventListener('mouseleave', () => {
            this.voice.stopVoiceRecording(this.state);
            this.ui.updateVoiceButton(this.state);
        });
    }

    private setupFormatSelectors(): void {
        if (!this.container) return;

        // Format selector
        const formatSelect = this.container.querySelector('.format-select') as HTMLSelectElement;
        if (!formatSelect) return;
        formatSelect.addEventListener('change', async () => {
            const newFormat = formatSelect.value as "auto" | "markdown" | "json" | "text" | "raw" | "html" | "code";
            this.state.outputFormat = newFormat;
            const { WorkCenterStateManager } = await import('./WorkCenterState');
            WorkCenterStateManager.saveState(this.state);

            // Re-render existing results if available
            if (this.state.lastRawResult) {
                const outputContent = this.container?.querySelector('[data-output]') as HTMLElement;
                const { WorkCenterDataProcessing } = await import('./WorkCenterDataProcessing');
                const dataProcessing = new WorkCenterDataProcessing();
                const formattedResult = dataProcessing.formatResult(this.state.lastRawResult, newFormat);
                outputContent.innerHTML = `<div class="result-content">${formattedResult}</div>`;
            }
        });

        // Language selector
        const languageSelect = this.container.querySelector('.language-select') as HTMLSelectElement;
        if (!languageSelect) return;
        languageSelect.addEventListener('change', async () => {
            this.state.selectedLanguage = languageSelect.value as "auto" | "en" | "ru";
            const { WorkCenterStateManager } = await import('./WorkCenterState');
            WorkCenterStateManager.saveState(this.state);
            // Language change doesn't need re-rendering since it affects future AI calls
        });

        // Recognition format selector
        const recognitionSelect = this.container.querySelector('.recognition-select') as HTMLSelectElement;
        if (!recognitionSelect) return;
        recognitionSelect.addEventListener('change', async () => {
            this.state.recognitionFormat = recognitionSelect.value as "auto" | "markdown" | "html" | "text" | "json" | "most-suitable" | "most-optimized" | "most-legibility";
            const { WorkCenterStateManager } = await import('./WorkCenterState');
            WorkCenterStateManager.saveState(this.state);
            // Recognition format change doesn't need re-rendering since it affects future AI calls
        });

        // Processing format selector
        const processingSelect = this.container.querySelector('.processing-select') as HTMLSelectElement;
        if (!processingSelect) return;
        processingSelect.addEventListener('change', async () => {
            this.state.processingFormat = processingSelect.value as "markdown" | "html" | "json" | "text" | "typescript" | "javascript" | "python" | "java" | "cpp" | "csharp" | "php" | "ruby" | "go" | "rust" | "xml" | "yaml" | "css" | "scss";
            const { WorkCenterStateManager } = await import('./WorkCenterState');
            WorkCenterStateManager.saveState(this.state);
            // Processing format change doesn't need re-rendering since it affects future AI calls
        });
    }

    private setupAutoActionCheckbox(): void {
        if (!this.container) return;

        const autoCheckbox = this.container.querySelector('.auto-action-checkbox') as HTMLInputElement;
        if (!autoCheckbox) return;
        autoCheckbox.addEventListener('change', async () => {
            this.state.autoAction = autoCheckbox.checked;
            const { WorkCenterStateManager } = await import('./WorkCenterState');
            WorkCenterStateManager.saveState(this.state);
        });
    }

    private setupActionButtons(): void {
        if (!this.container) return;

        this.container.addEventListener('click', async (e) => {
            const target = e.target as HTMLElement;
            const action = target.closest('[data-action]')?.getAttribute('data-action');

            if (!action) return;

            switch (action) {
                case 'edit-templates':
                    this.templates.showTemplateEditor(this.state, this.container as HTMLElement);
                    break;
                case 'refresh-instructions':
                    await this.prompts.populateInstructionSelect(this.state);
                    this.prompts.updateInstructionSelect(this.state);
                    break;
                case 'clear-prompt':
                    this.prompts.clearPrompt(this.state);
                    break;
                case 'copy-results':
                    await this.actions.copyResults(this.state);
                    break;
                case 'view-output':
                    await this.actions.viewResultsInViewer(this.state);
                    break;
                case 'save-to-explorer':
                    await this.actions.saveResultsToExplorer(this.state);
                    break;
                case 'clear-results':
                    this.actions.clearResults(this.state);
                    break;
                case 'clear-all-files':
                    this.attachments.clearAllFiles(this.state);
                    break;
                case 'view-full-history':
                    this.deps.state.view = 'history';
                    this.deps.render();
                    break;
                case 'view-action-history':
                    this.showActionHistory();
                    break;
                case 'execute':
                    await this.actions.executeUnifiedAction(this.state);
                    break;
                case 'switch-input-tab':
                    this.switchInputTab(String(target.closest('[data-tab]')?.getAttribute('data-tab') || 'prompt'));
                    break;
                case 'switch-results-tab':
                    this.switchResultsTab(String(target.closest('[data-tab]')?.getAttribute('data-tab') || 'output'));
                    break;
                case 'clear-recognized':
                    const { WorkCenterStateManager: StateManager1 } = await import('./WorkCenterState');
                    StateManager1.clearRecognizedData(this.state);
                    // Update the UI to remove the recognized status and pipeline
                    const statusElement = this.container?.querySelector('.wc-recognized-status');
                    if (statusElement) {
                        statusElement.remove();
                    }
                    this.ui.updateDataPipeline(this.state);
                    break;
                case 'clear-pipeline':
                    const { WorkCenterStateManager: StateManager2 } = await import('./WorkCenterState');
                    StateManager2.clearRecognizedData(this.state);
                    // Also clear attachments & preview URLs (pipeline reset means "start over")
                    this.ui.revokeAllPreviewUrls(this.state);
                    this.state.files = [];
                    this.ui.updateFileList(this.state);
                    this.ui.updateFileCounter(this.state);
                    this.deps.onFilesChanged?.();
                    // Update UI
                    const statusEl = this.container?.querySelector('.wc-recognized-status');
                    if (statusEl) {
                        statusEl.remove();
                    }
                    this.ui.updateDataPipeline(this.state);
                    break;
            }
        });
    }

    private setupPipelineRestoration(): void {
        if (!this.container) return;

        this.container.addEventListener('click', async (e) => {
            const target = e.target as HTMLElement;
            const stepIndex = target.getAttribute('data-restore-step');

            if (stepIndex !== null) {
                const index = parseInt(stepIndex);
                if (this.state.processedData && this.state.processedData[index]) {
                    const step = this.state.processedData[index];
                    // Restore this processing step result to the output
                    const outputContent = this.container?.querySelector('[data-output]') as HTMLElement;
                    const { WorkCenterDataProcessing } = await import('./WorkCenterDataProcessing');
                    const dataProcessing = new WorkCenterDataProcessing();
                    const formattedResult = dataProcessing.formatResult({ content: step.content }, this.state.outputFormat);
                    outputContent.innerHTML = `<div class="result-content">${formattedResult}</div>`;
                    this.state.lastRawResult = { data: step.content };
                }
            }
        });
    }

    private setupInputTabs(): void {
        if (!this.container) return;
        this.switchInputTab(this.state.activeInputTab || "prompt");
    }

    private setupResultsTabs(): void {
        if (!this.container) return;
        this.switchResultsTab(this.state.activeResultsTab || "output");
    }

    private setupHeaderControlsOverlay(): void {
        if (!this.container) return;
        const disclosure = this.container.querySelector('.header-controls-disclosure') as HTMLDetailsElement | null;
        if (!disclosure) return;

        document.addEventListener('click', (event) => {
            if (!disclosure.open) return;
            const target = event.target as Node | null;
            if (target && !disclosure.contains(target)) {
                disclosure.open = false;
            }
        });

        this.container.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && disclosure.open) {
                disclosure.open = false;
            }
        });
    }

    private switchInputTab(tab: string): void {
        if (!this.container) return;
        if (!["prompt", "attachments"].includes(tab)) return;

        this.state.activeInputTab = tab as WorkCenterState["activeInputTab"];
        this.container.querySelector('[data-input-tabs]')?.setAttribute('data-active-tab', tab);

        const tabButtons = this.container.querySelectorAll('[data-action="switch-input-tab"][data-tab]');
        for (const tabButton of Array.from(tabButtons)) {
            const btn = tabButton as HTMLButtonElement;
            const isActive = btn.getAttribute('data-tab') === tab;
            btn.classList.toggle('is-active', isActive);
            btn.setAttribute('aria-selected', String(isActive));
        }

        const tabPanels = this.container.querySelectorAll('[data-tab-panel]');
        for (const panel of Array.from(tabPanels)) {
            const el = panel as HTMLElement;
            const isActive = el.getAttribute('data-tab-panel') === tab;
            el.classList.toggle('is-active', isActive);
        }

        void import('./WorkCenterState')
            .then(({ WorkCenterStateManager }) => WorkCenterStateManager.saveState(this.state))
            .catch(() => {
                // ignore persistence failures for tab state
            });
    }

    private switchResultsTab(tab: string): void {
        if (!this.container) return;
        if (!["output", "pipeline", "history"].includes(tab)) return;

        const hasPipelineData = Boolean(this.state.recognizedData || (this.state.processedData && this.state.processedData.length > 0));
        const nextTab = (tab === "pipeline" && !hasPipelineData) ? "output" : tab;

        this.state.activeResultsTab = nextTab as WorkCenterState["activeResultsTab"];
        this.container.querySelector('[data-results-tabs]')?.setAttribute('data-active-tab', nextTab);

        const tabButtons = this.container.querySelectorAll('[data-action="switch-results-tab"][data-tab]');
        for (const tabButton of Array.from(tabButtons)) {
            const btn = tabButton as HTMLButtonElement;
            const isActive = btn.getAttribute('data-tab') === nextTab;
            btn.classList.toggle('is-active', isActive);
            btn.setAttribute('aria-selected', String(isActive));
        }

        const tabPanels = this.container.querySelectorAll('[data-results-tab-panel]');
        for (const panel of Array.from(tabPanels)) {
            const el = panel as HTMLElement;
            const isActive = el.getAttribute('data-results-tab-panel') === nextTab;
            el.classList.toggle('is-active', isActive);
        }

        void import('./WorkCenterState')
            .then(({ WorkCenterStateManager }) => WorkCenterStateManager.saveState(this.state))
            .catch(() => {
                // ignore persistence failures for tab state
            });
    }

    private setupPromptDropzone(): void {
        if (!this.container) return;
        const promptDropzone = this.container.querySelector('[data-prompt-dropzone]') as HTMLElement | null;
        if (!promptDropzone) return;

        const overlay = this.container.querySelector('[data-prompt-drop-hint]') as HTMLElement | null;

        promptDropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            promptDropzone.classList.add('drag-over');
            overlay?.classList.add('visible');
        });

        promptDropzone.addEventListener('dragleave', (e) => {
            const rect = promptDropzone.getBoundingClientRect();
            const x = e.clientX;
            const y = e.clientY;
            if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
                promptDropzone.classList.remove('drag-over');
                overlay?.classList.remove('visible');
            }
        });

        promptDropzone.addEventListener('drop', async (e) => {
            e.preventDefault();
            promptDropzone.classList.remove('drag-over');
            overlay?.classList.remove('visible');

            const dt = e.dataTransfer;
            if (!dt) return;

            const files = Array.from(dt.files || []);
            if (files.length > 0) {
                this.fileOps.addFilesFromInput(this.state, files as any);
                this.ui.updateFileList(this.state);
                this.ui.updateFileCounter(this.state);
                this.deps.onFilesChanged?.();
                return;
            }

            if (dt.types.includes('text/plain')) {
                const text = dt.getData('text/plain')?.trim();
                if (text) {
                    await this.fileOps.handleDroppedContent(this.state, text, 'text');
                    this.ui.updateFileList(this.state);
                    this.ui.updateFileCounter(this.state);
                    this.deps.onFilesChanged?.();
                    return;
                }
            }

            if (dt.types.includes('text/uri-list')) {
                const uriList = dt.getData('text/uri-list');
                const urls = uriList.split('\n').filter((url) => url.trim() && !url.startsWith('#'));
                const firstUrl = urls[0]?.trim();
                if (firstUrl) {
                    await this.fileOps.handleDroppedContent(this.state, firstUrl, 'url');
                    this.ui.updateFileList(this.state);
                    this.ui.updateFileCounter(this.state);
                    this.deps.onFilesChanged?.();
                    return;
                }
            }

            if (dt.types.includes('text/html')) {
                const html = dt.getData('text/html');
                if (html) {
                    const temp = document.createElement('div');
                    temp.innerHTML = html;
                    const extracted = (temp.textContent || temp.innerText || '').trim();
                    if (extracted) {
                        await this.fileOps.handleDroppedContent(this.state, extracted, 'html');
                        this.ui.updateFileList(this.state);
                        this.ui.updateFileCounter(this.state);
                        this.deps.onFilesChanged?.();
                        return;
                    }
                }
            }
        });
    }

    private showActionHistory(): void {
        this.history.showActionHistory();
    }

    private isValidUrl(string: string): boolean {
        try {
            new URL(string);
            return true;
        } catch {
            return false;
        }
    }
}