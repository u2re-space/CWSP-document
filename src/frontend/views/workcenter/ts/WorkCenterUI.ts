import { H } from "fest/lure";
import type { WorkCenterState, WorkCenterDependencies } from "./WorkCenterState";
import type { WorkCenterResults } from "./WorkCenterResults";
import type { WorkCenterAttachments } from "./WorkCenterAttachments";
import type { WorkCenterPrompts } from "./WorkCenterPrompts";
import type { WorkCenterHistory } from "./WorkCenterHistory";

export class WorkCenterUI {
    private container: HTMLElement | null = null;
    private deps: WorkCenterDependencies;
    private attachments: WorkCenterAttachments;
    private prompts: WorkCenterPrompts;
    private results: WorkCenterResults;
    private history: WorkCenterHistory;

    constructor(
        dependencies: WorkCenterDependencies,
        attachments: WorkCenterAttachments,
        prompts: WorkCenterPrompts,
        results: WorkCenterResults,
        history: WorkCenterHistory
    ) {
        this.deps = dependencies;
        this.attachments = attachments;
        this.prompts = prompts;
        this.results = results;
        this.history = history;
    }

    setContainer(container: HTMLElement | null): void {
        this.container = container;
        this.attachments.setContainer(container);
        this.prompts.setContainer(container);
        this.results.setContainer(container);
        this.history.setContainer(container);
    }

    getContainer(): HTMLElement | null {
        return this.container;
    }

    renderWorkCenterView(state: WorkCenterState): HTMLElement {
        const container = H`<div class="workcenter-view">
      <div class="workcenter-header">
        <h2>AI Work Center</h2>
        <details class="header-controls-disclosure">
          <summary class="header-controls-summary">
            <span>AI Work Center</span>
          </summary>
          <div class="control-selectors">
          <div class="format-selector">
            <label>Output Format:</label>
            <select class="format-select">
              <option value="auto" ${state.outputFormat === 'auto' ? 'selected' : ''}>Auto</option>
              <option value="markdown" ${state.outputFormat === 'markdown' ? 'selected' : ''}>Markdown</option>
              <option value="json" ${state.outputFormat === 'json' ? 'selected' : ''}>JSON</option>
              <option value="code" ${state.outputFormat === 'code' ? 'selected' : ''}>Code</option>
              <option value="raw" ${state.outputFormat === 'raw' ? 'selected' : ''}>Raw Text</option>
              <option value="text" ${state.outputFormat === 'text' ? 'selected' : ''}>Plain Text</option>
              <option value="html" ${state.outputFormat === 'html' ? 'selected' : ''}>HTML</option>
            </select>
          </div>
          <div class="language-selector">
            <label>Language:</label>
            <select class="language-select">
              <option value="auto" ${state.selectedLanguage === 'auto' ? 'selected' : ''}>Auto</option>
              <option value="en" ${state.selectedLanguage === 'en' ? 'selected' : ''}>English</option>
              <option value="ru" ${state.selectedLanguage === 'ru' ? 'selected' : ''}>Русский</option>
            </select>
          </div>
          <div class="recognition-selector">
            <label>Recognize as:</label>
            <select class="recognition-select">
              <option value="auto" ${state.recognitionFormat === 'auto' ? 'selected' : ''}>Auto</option>
              <option value="most-suitable" ${state.recognitionFormat === 'most-suitable' ? 'selected' : ''}>Most Suitable</option>
              <option value="most-optimized" ${state.recognitionFormat === 'most-optimized' ? 'selected' : ''}>Most Optimized</option>
              <option value="most-legibility" ${state.recognitionFormat === 'most-legibility' ? 'selected' : ''}>Most Legible</option>
              <option value="markdown" ${state.recognitionFormat === 'markdown' ? 'selected' : ''}>Markdown</option>
              <option value="html" ${state.recognitionFormat === 'html' ? 'selected' : ''}>HTML</option>
              <option value="text" ${state.recognitionFormat === 'text' ? 'selected' : ''}>Plain Text</option>
              <option value="json" ${state.recognitionFormat === 'json' ? 'selected' : ''}>JSON</option>
            </select>
          </div>
          <div class="processing-selector">
            <label>Process as:</label>
            <select class="processing-select">
              <option value="markdown" ${state.processingFormat === 'markdown' ? 'selected' : ''}>Markdown</option>
              <option value="html" ${state.processingFormat === 'html' ? 'selected' : ''}>HTML</option>
              <option value="json" ${state.processingFormat === 'json' ? 'selected' : ''}>JSON</option>
              <option value="text" ${state.processingFormat === 'text' ? 'selected' : ''}>Plain Text</option>
              <option value="typescript" ${state.processingFormat === 'typescript' ? 'selected' : ''}>TypeScript</option>
              <option value="javascript" ${state.processingFormat === 'javascript' ? 'selected' : ''}>JavaScript</option>
              <option value="python" ${state.processingFormat === 'python' ? 'selected' : ''}>Python</option>
              <option value="java" ${state.processingFormat === 'java' ? 'selected' : ''}>Java</option>
              <option value="cpp" ${state.processingFormat === 'cpp' ? 'selected' : ''}>C++</option>
              <option value="csharp" ${state.processingFormat === 'csharp' ? 'selected' : ''}>C#</option>
              <option value="php" ${state.processingFormat === 'php' ? 'selected' : ''}>PHP</option>
              <option value="ruby" ${state.processingFormat === 'ruby' ? 'selected' : ''}>Ruby</option>
              <option value="go" ${state.processingFormat === 'go' ? 'selected' : ''}>Go</option>
              <option value="rust" ${state.processingFormat === 'rust' ? 'selected' : ''}>Rust</option>
              <option value="xml" ${state.processingFormat === 'xml' ? 'selected' : ''}>XML</option>
              <option value="yaml" ${state.processingFormat === 'yaml' ? 'selected' : ''}>YAML</option>
              <option value="css" ${state.processingFormat === 'css' ? 'selected' : ''}>CSS</option>
              <option value="scss" ${state.processingFormat === 'scss' ? 'selected' : ''}>SCSS</option>
            </select>
          </div>
          </div>
        </details>
      </div>

      <div class="workcenter-content">
        <div class="workcenter-layout">

          <!-- Results & Processing Section -->
          <div class="workcenter-block results-block">
            <div class="results-section">
              ${this.renderResultsTabs(state)}
            </div>
          </div>

          <!-- Input Prompts Section -->
          <div class="workcenter-block prompts-block">
            ${this.renderInputTabs(state)}
          </div>
        </div>
      </div>
    </div>` as HTMLElement;

        this.container = container;
        this.attachments.setContainer(container);
        this.prompts.setContainer(container);
        this.results.setContainer(container);

        // Initialize UI components
        this.initializeUI(state);

        return container;
    }

    private initializeUI(state: WorkCenterState): void {
        // Setup drop zone functionality for attachments
        this.attachments.setupDropZone(state);

        // Initialize file list and counters
        this.attachments.updateFileList(state);
        this.attachments.updateFileCounter(state);
        this.prompts.updatePromptFileCount(state);
        this.updateInputTabFileCount(state);
        this.updateResultsPipelineTabState(state);
        this.history.updateRecentHistory(state);
    }

    updateFileCounter(state: WorkCenterState): void {
        this.attachments.updateFileCounter(state);
        this.prompts.updatePromptFileCount(state);
        this.updateInputTabFileCount(state);
    }

    updateFileList(state: WorkCenterState): void {
        this.attachments.updateFileList(state);
        this.prompts.updatePromptFileCount(state);
        this.updateInputTabFileCount(state);
    }

    updatePromptInput(state: WorkCenterState): void {
        this.prompts.updatePromptInput(state);
    }

    updateTemplateSelect(state: WorkCenterState): void {
        this.prompts.updateTemplateSelect(state);
    }

    updateVoiceButton(state: WorkCenterState): void {
        this.prompts.updateVoiceButton(state);
    }


    updateDataPipeline(state: WorkCenterState): void {
        this.results.updateDataPipeline(state);
        this.updateResultsPipelineTabState(state);
    }

    updateDataCounters(state: WorkCenterState): void {
        this.attachments.updateDataCounters(state);
    }

    showProcessingMessage(message: string): void {
        this.results.showProcessingMessage(message);
    }

    showResult(state: WorkCenterState): void {
        this.results.showResult(state);
    }

    showError(error: string): void {
        this.results.showError(error);
    }

    clearResults(): void {
        this.results.clearResults();
    }

    revokeAllPreviewUrls(state: WorkCenterState): void {
        this.attachments.revokeAllPreviewUrls(state);
    }

    private renderInputTabs(state: WorkCenterState): string {
        const activeTab = state.activeInputTab || "prompt";
        return `
            <div class="input-tabs-section" data-input-tabs data-active-tab="${activeTab}">
                <div class="wc-block-header">
                    <div class="input-tab-actions">
                        <button class="tab-btn ${activeTab === 'prompt' ? 'is-active' : ''}" data-action="switch-input-tab" data-tab="prompt" aria-selected="${activeTab === 'prompt'}">Prompt</button>
                        <button class="tab-btn ${activeTab === 'attachments' ? 'is-active' : ''}" data-action="switch-input-tab" data-tab="attachments" aria-selected="${activeTab === 'attachments'}">Files (${state.files.length})</button>
                    </div>
                    <h3>Work Inputs</h3>
                    <div class="file-actions">
                        <button class="btn btn-icon" data-action="select-files" title="Choose Files">
                            <ui-icon icon="folder-open" size="18" icon-style="duotone"></ui-icon>
                            <span class="btn-text">Add Files</span>
                        </button>
                        <button class="btn btn-icon" data-action="clear-all-files" title="Clear All Files">
                            <ui-icon icon="trash" size="18" icon-style="duotone"></ui-icon>
                            <span class="btn-text">Clear All</span>
                        </button>
                    </div>
                </div>
                <div class="input-tab-panels">
                    <section class="tab-panel ${activeTab === 'prompt' ? 'is-active' : ''}" data-tab-panel="prompt">
                        ${this.prompts.renderPromptPanel(state)}
                    </section>
                    <section class="tab-panel ${activeTab === 'attachments' ? 'is-active' : ''}" data-tab-panel="attachments">
                        ${this.attachments.renderAttachmentsSection(state)}
                    </section>
                </div>
            </div>
        `;
    }

    private renderResultsTabs(state: WorkCenterState): string {
        const hasPipelineData = Boolean(state.recognizedData || (state.processedData && state.processedData.length > 0));
        const pipelineCount = (state.recognizedData ? 1 : 0) + (state.processedData?.length || 0);
        const activeTab = state.activeResultsTab === "pipeline" && !hasPipelineData
            ? "output"
            : state.activeResultsTab;

        return `
            <div class="results-tabs-section" data-results-tabs data-active-tab="${activeTab}">
                <div class="wc-block-header results-tabs-header">
                    <div class="results-tab-actions">
                        <button class="tab-btn ${activeTab === 'output' ? 'is-active' : ''}" data-action="switch-results-tab" data-tab="output" aria-selected="${activeTab === 'output'}">Output</button>
                        <button class="tab-btn ${activeTab === 'pipeline' ? 'is-active' : ''}" data-action="switch-results-tab" data-tab="pipeline" aria-selected="${activeTab === 'pipeline'}"${hasPipelineData ? '' : ' disabled'}>Pipeline (${pipelineCount})</button>
                        <button class="tab-btn ${activeTab === 'history' ? 'is-active' : ''}" data-action="switch-results-tab" data-tab="history" aria-selected="${activeTab === 'history'}">History</button>
                    </div>
                    <h3>Results & Processing</h3>
                    ${this.results.renderOutputHeader()}
                </div>
                <div class="results-tab-panels">
                    <section class="results-tab-panel ${activeTab === 'output' ? 'is-active' : ''}" data-results-tab-panel="output">
                        <div class="wc-output-section">
                            ${this.results.renderOutputContent()}
                        </div>
                    </section>
                    <section class="results-tab-panel ${activeTab === 'pipeline' ? 'is-active' : ''}" data-results-tab-panel="pipeline">
                        ${hasPipelineData ? this.results.renderDataPipeline(state) : '<div class="wc-results-empty">No data pipeline yet</div>'}
                    </section>
                    <section class="results-tab-panel ${activeTab === 'history' ? 'is-active' : ''}" data-results-tab-panel="history">
                        <div class="history-section">
                            <div class="history-header">
                                <h4>Recent Activity</h4>
                                <div class="result-actions">
                                    <button class="btn btn-icon" data-action="view-action-history" title="View Action History">
                                        <ui-icon icon="history" size="18" icon-style="duotone"></ui-icon>
                                        <span class="btn-text">History</span>
                                    </button>
                                    <button class="btn" data-action="view-full-history">View All History</button>
                                </div>
                            </div>
                            <div class="recent-history" data-recent-history></div>
                            <div class="action-stats" data-action-stats style="display: none;"></div>
                        </div>
                    </section>
                </div>
            </div>
        `;
    }

    private updateInputTabFileCount(state: WorkCenterState): void {
        if (!this.container) return;
        const filesTabBtn = this.container.querySelector('[data-action="switch-input-tab"][data-tab="attachments"]') as HTMLElement | null;
        if (filesTabBtn) {
            filesTabBtn.textContent = `Files (${state.files.length})`;
        }
    }

    private updateResultsPipelineTabState(state: WorkCenterState): void {
        if (!this.container) return;
        const hasPipelineData = Boolean(state.recognizedData || (state.processedData && state.processedData.length > 0));
        const pipelineCount = (state.recognizedData ? 1 : 0) + (state.processedData?.length || 0);
        const tabsRoot = this.container.querySelector('[data-results-tabs]') as HTMLElement | null;
        const pipelineTabBtn = this.container.querySelector('[data-action="switch-results-tab"][data-tab="pipeline"]') as HTMLButtonElement | null;
        if (!tabsRoot || !pipelineTabBtn) return;

        pipelineTabBtn.textContent = `Pipeline (${pipelineCount})`;
        pipelineTabBtn.disabled = !hasPipelineData;

        const activeTab = tabsRoot.getAttribute('data-active-tab') || 'output';
        if (!hasPipelineData && activeTab === 'pipeline') {
            tabsRoot.setAttribute('data-active-tab', 'output');
            state.activeResultsTab = 'output';

            const outputBtn = this.container.querySelector('[data-action="switch-results-tab"][data-tab="output"]') as HTMLButtonElement | null;
            if (outputBtn) {
                outputBtn.classList.add('is-active');
                outputBtn.setAttribute('aria-selected', 'true');
            }
            pipelineTabBtn.classList.remove('is-active');
            pipelineTabBtn.setAttribute('aria-selected', 'false');

            const outputPanel = this.container.querySelector('[data-results-tab-panel="output"]') as HTMLElement | null;
            const pipelinePanel = this.container.querySelector('[data-results-tab-panel="pipeline"]') as HTMLElement | null;
            outputPanel?.classList.add('is-active');
            pipelinePanel?.classList.remove('is-active');
        }
    }
}