import { executionCore } from "@rs-com/service/misc/ExecutionCore";
import type { ActionContext, ActionInput } from "@rs-com/service/misc/ActionHistory";
import type { WorkCenterState, WorkCenterDependencies } from "./WorkCenterState";
import type { WorkCenterUI } from "./WorkCenterUI";
import type { WorkCenterFileOps } from "./WorkCenterFileOps";
import type { WorkCenterResults } from "./WorkCenterResults";
import type { WorkCenterDataProcessing } from "./WorkCenterDataProcessing";
import type { WorkCenterHistory } from "./WorkCenterHistory";
import type { WorkCenterTemplates } from "./WorkCenterTemplates";
import { extractJSONFromAIResponse } from "@rs-core/document/AIResponseParser";

export class WorkCenterActions {
    private deps: WorkCenterDependencies;
    private ui: WorkCenterUI;
    private fileOps: WorkCenterFileOps;
    private dataProcessing: WorkCenterDataProcessing;
    private results: WorkCenterResults;
    private history: WorkCenterHistory;
    private templates: WorkCenterTemplates;

    constructor(
        dependencies: WorkCenterDependencies,
        ui: WorkCenterUI,
        fileOps: WorkCenterFileOps,
        dataProcessing: WorkCenterDataProcessing,
        results: WorkCenterResults,
        history: WorkCenterHistory,
        templates?: WorkCenterTemplates
    ) {
        this.deps = dependencies;
        this.ui = ui;
        this.fileOps = fileOps;
        this.dataProcessing = dataProcessing;
        this.results = results;
        this.history = history;
        this.templates = templates!;
    }

    async executeUnifiedAction(state: WorkCenterState): Promise<void> {
        if (this.fileOps.getFilesForProcessing(state).length === 0 && !state.currentPrompt.trim() && !state.recognizedData) {
            this.deps.showMessage('Please select files or enter a prompt first');
            return;
        }

        let processingMessage = 'Processing...';

        // Show what's being processed
        if (state.recognizedData) {
            processingMessage = `Processing ${state.recognizedData.source} content...`;
        } else if (this.fileOps.hasFiles(state)) {
            processingMessage = `Processing ${state.files.length} file${state.files.length > 1 ? 's' : ''}...`;
        }

        this.results.showProcessingMessage(processingMessage);

        try {
            // Prepare input for execution core
            let basePrompt = state.currentPrompt.trim() ||
                (state.autoAction ? this.getLastSuccessfulPrompt() : "Analyze and process the provided content intelligently");

            // Apply selected or active custom instruction from settings (if any)
            if (this.templates) {
                let instruction = this.templates.resolveInstruction(state.selectedInstruction);
                if (!instruction && !state.selectedInstruction) {
                    instruction = await this.templates.getActiveInstruction();
                }
                if (instruction?.instruction) {
                    if (!state.selectedInstruction) {
                        state.selectedInstruction = instruction.id;
                    }
                    basePrompt = this.templates.buildPromptWithInstruction(basePrompt, instruction);
                }
            }

            const actionInput: ActionInput = {
                type: state.recognizedData ? 'text' : (this.fileOps.hasFiles(state) ? 'files' : 'text'),
                files: this.fileOps.hasFiles(state) ? [...state.files] : undefined,
                text: basePrompt,
                recognizedData: state.recognizedData || undefined,
                // Keep legacy field for backward compatibility
                recognizedContent: state.recognizedData?.content || undefined
            };

            // Handle special templates that need dynamic language processing
            const isTranslateTemplate = state.selectedTemplate &&
                state.selectedTemplate.includes("Translate the following content to the selected language");

            if (isTranslateTemplate && state.selectedLanguage !== 'auto') {
                // For "Translate to Language" template, replace the generic instruction with specific language
                const targetLanguage = state.selectedLanguage === 'ru' ? 'Russian' : 'English';
                actionInput.text = `Translate the following content to ${targetLanguage}. Maintain the original formatting and structure where possible. If the content is already in ${targetLanguage}, provide a natural rephrasing or improvement instead.`;
            } else {
                // Add language instruction if specific language selected (for other operations)
                if (state.selectedLanguage !== 'auto') {
                    const languageInstruction = state.selectedLanguage === 'ru'
                        ? "Please respond in Russian language."
                        : "Please respond in English language.";
                    actionInput.text = `${languageInstruction} ${actionInput.text}`;
                }
            }

            // Execute through execution core
            const context: ActionContext = {
                source: 'workcenter',
                sessionId: this.generateSessionId()
            };

            // Determine action based on content type and state
            let forceAction: string | undefined;

            // If user has provided a specific prompt/template instruction, use it directly
            // Don't force a generic action that would override the user's instruction
            const hasUserInstruction = state.currentPrompt.trim() && state.currentPrompt.trim() !== "Analyze and process the provided content intelligently";

            if (hasUserInstruction) {
                // User has provided their own instruction - let the system determine the best action type
                // based on available data, but use the user's instruction
                forceAction = undefined; // Let the system auto-determine based on input type
            } else if (state.recognizedData) {
                // We have recognized data but no specific user instruction - do additional processing
                forceAction = 'analyze';
            } else if (this.fileOps.hasFiles(state)) {
                // We have files but no recognized data - do initial recognition
                const hasTextFiles = this.fileOps.hasTextFiles(state);

                if (hasTextFiles) {
                    // Text files can be processed as source data
                    forceAction = 'source';
                } else {
                    // Binary files need recognition
                    forceAction = 'recognize';
                }
            } else {
                // No files, no recognized data, no user instruction - general analysis
                forceAction = 'analyze';
            }

            const result = await executionCore.execute(actionInput, context, {
                forceAction,
                recognitionFormat: state.recognitionFormat,
                processingFormat: state.processingFormat
            });

            // Save state
            const { WorkCenterStateManager } = await import('./WorkCenterState');
            WorkCenterStateManager.saveState(state);

            // Store raw result for copying
            state.lastRawResult = result.rawData;

            // Format and display result
            const formattedResult = this.dataProcessing.formatResult(result.rawData || result, state.outputFormat);
            const outputContent = this.ui.getContainer()?.querySelector('[data-output]') as HTMLElement | null;
            if (outputContent) {
                outputContent.innerHTML = `<div class="result-content">${formattedResult}</div>`;
            }

            // Update recognized data if files were processed (initial recognition or source data)
            if (this.fileOps.hasFiles(state) && result.rawData?.ok && !state.recognizedData) {
                const isTextFile = this.fileOps.hasTextFiles(state);

                state.recognizedData = {
                    content: result.content,
                    timestamp: Date.now(),
                    source: isTextFile ? 'text' : 'files',
                    recognizedAs: this.fileOps.determineRecognizedFormat(state),
                    metadata: {
                        fileCount: state.files.length
                    },
                    responseId: result.responseId || "unknown"
                };
                this.results.updateDataPipeline(state);
                this.ui.updateDataCounters(state);

                // Auto-process with selected template if available
                if (state.selectedTemplate && state.selectedTemplate.trim()) {
                    console.log('[WorkCenter] Auto-processing with template:', state.selectedTemplate);
                    // Small delay to allow UI to update
                    setTimeout(async () => {
                        await this.executeUnifiedAction(state);
                    }, 100);
                }
            }
            // Add to processing chain if we have recognized data (additional processing)
            else if (state.recognizedData && result.rawData?.ok) {
                const processedEntry = {
                    content: result.content,
                    timestamp: Date.now(),
                    action: state.currentPrompt.trim() || 'additional processing',
                    sourceData: state.recognizedData,
                    metadata: { step: state.currentProcessingStep + 1 }
                };

                const { WorkCenterStateManager: StateManager } = await import('./WorkCenterState');
                StateManager.addProcessedStep(state, processedEntry);
            }

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            this.results.showError(errorMsg);
        }

        this.history.updateRecentHistory(state);
        this.ui.updateDataPipeline(state);
        this.ui.updateDataCounters(state);
    }

    private getLastSuccessfulPrompt(): string {
        return this.history.getLastSuccessfulPrompt();
    }

    private generateSessionId(): string {
        return `wc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    async copyResults(state: WorkCenterState): Promise<void> {
        if (!state.lastRawResult) return;

        try {
            await this.dataProcessing.copyResultsToClipboard(state.lastRawResult, state.outputFormat);
            this.deps.showMessage('Results copied to clipboard');
        } catch (error) {
            console.error('Failed to copy results:', error);
            this.deps.showMessage('Failed to copy results');
        }
    }

    async viewResultsInViewer(state: WorkCenterState): Promise<void> {
        if (!state.lastRawResult) {
            this.deps.showMessage('No results to view');
            return;
        }

        try {
            const { unifiedMessaging } = await import('@rs-com/core/UnifiedMessaging');

            let resultContent = typeof state.lastRawResult === 'string'
                ? state.lastRawResult
                : JSON.stringify(state.lastRawResult, null, 2);

            try {
                resultContent = JSON.parse(resultContent)?.data || resultContent;
            } catch (error) {
            }

            await unifiedMessaging.sendMessage({
                id: crypto.randomUUID(),
                type: 'content-view',
                source: 'workcenter',
                destination: 'viewer',
                contentType: state.outputFormat === 'markdown' ? 'markdown' : 'text',
                data: {
                    text: resultContent,
                    filename: `workcenter-output-${Date.now()}.${state.outputFormat === 'markdown' ? 'md' : (state.outputFormat === 'json' ? 'json' : (state.outputFormat === 'html' ? 'html' : (state.outputFormat === 'code' ? 'ts' : 'txt')))}`
                },
                metadata: {
                    title: 'Work Center Output',
                    timestamp: Date.now(),
                    source: 'workcenter',
                    format: state.outputFormat
                }
            } as any);

            await this.navigateToViewer();
        } catch (error) {
            console.error('Failed to open output in viewer:', error);
            this.deps.showMessage('Failed to open output in viewer');
        }
    }

    private async navigateToViewer(): Promise<void> {
        if (this.deps.navigate) {
            await this.deps.navigate('viewer');
            return;
        }

        // Backward compatibility for legacy state-based navigation.
        if (this.deps?.state) {
            this.deps.state.view = 'markdown-viewer';
            this.deps.render?.();
        }
    }

    clearResults(state: WorkCenterState): void {
        state.lastRawResult = null;
        this.results.clearResults();
    }

    async saveResultsToExplorer(state: WorkCenterState): Promise<void> {
        if (!state.lastRawResult) {
            this.deps.showMessage('No results to save');
            return;
        }

        try {
            // Import the unified messaging system
            const { unifiedMessaging } = await import('@rs-com/core/UnifiedMessaging');

            // Create the content to save
            const resultContent = typeof state.lastRawResult === 'string'
                ? state.lastRawResult
                : JSON.stringify(state.lastRawResult, null, 2);

            // Send to explorer for saving
            await unifiedMessaging.sendMessage({
                id: crypto.randomUUID(),
                type: 'content-save',
                source: 'workcenter',
                destination: 'explorer',
                data: {
                    action: 'save',
                    text: resultContent,
                    filename: `workcenter-result-${Date.now()}.${state.outputFormat === 'json' ? 'json' : (state.outputFormat === 'html' ? 'html' : (state.outputFormat === 'code' ? 'ts' : 'txt'))}`,
                    path: '/workcenter-results/'
                },
                metadata: {
                    title: 'Work Center Result',
                    timestamp: Date.now(),
                    source: 'workcenter',
                    format: state.outputFormat
                }
            });

            this.deps.showMessage('Results saved to Explorer');
        } catch (error) {
            console.error('Failed to save results to explorer:', error);
            this.deps.showMessage('Failed to save results to Explorer');
        }
    }
}