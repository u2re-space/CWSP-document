export interface WorkCenterState {
    files: File[];
    selectedFiles: File[];
    currentPrompt: string;
    autoAction: boolean;
    selectedInstruction: string;
    outputFormat: "auto" | "markdown" | "json" | "text" | "raw" | "html" | "code";
    activeInputTab: "instruction" | "prompt" | "attachments";
    activeResultsTab: "output" | "pipeline" | "history";
    selectedLanguage: "auto" | "en" | "ru"; // Language selection for AI responses
    selectedTemplate: string; // Store the selected template prompt
    recognitionFormat: "auto" | "markdown" | "html" | "text" | "json" | "most-suitable" | "most-optimized" | "most-legibility"; // Preferred recognition format
    processingFormat: "markdown" | "html" | "json" | "text" | "typescript" | "javascript" | "python" | "java" | "cpp" | "csharp" | "php" | "ruby" | "go" | "rust" | "xml" | "yaml" | "css" | "scss"; // Processing output format
    voiceRecording: boolean;
    promptTemplates: { name: string, prompt: string }[];
    lastRawResult: any; // Store raw result for copying unparsed content

    // Data processing pipeline
    recognizedData: {
        content: string;
        timestamp: number;
        source: 'files' | 'text' | 'url' | 'markdown' | 'image' | 'mixed';
        recognizedAs: 'markdown' | 'html' | 'text' | 'json' | 'xml' | 'other'; // Format recognized as
        metadata?: Record<string, any>;
        responseId?: string; // GPT/AI response ID from HTTP level
    } | null; // Raw recognized content from files/images

    processedData: {
        content: string;
        timestamp: number;
        action: string; // Template/action applied
        sourceData: any; // Reference to what was processed
        metadata?: any;
    }[] | null; // Chain of processed results

    currentProcessingStep: number; // Current step in processing chain
}

export interface WorkCenterDependencies {
    state: any; // App state
    history: any[]; // History array
    getSpeechPrompt: () => Promise<string | null>;
    showMessage: (message: string) => void;
    render: () => void;
    navigate?: (viewId: string) => Promise<void> | void; // Optional shell navigation API
    onFilesChanged?: () => void; // Callback when files are added/removed
}

export class WorkCenterStateManager {
    private static readonly STORAGE_KEY = "rs-workcenter-state";
    private static readonly TEMPLATES_STORAGE_KEY = "rs-workcenter-templates";

    static createDefaultState(): WorkCenterState {
        return {
            files: [],
            selectedFiles: [],
            currentPrompt: "",
            autoAction: false,
            selectedInstruction: "",
            outputFormat: "auto",
            activeInputTab: "prompt",
            activeResultsTab: "output",
            selectedLanguage: "auto",
            selectedTemplate: "",
            recognitionFormat: "auto",
            processingFormat: "markdown",
            voiceRecording: false,
            promptTemplates: this.loadPromptTemplates(),
            lastRawResult: null,
            recognizedData: null,
            processedData: null,
            currentProcessingStep: 0,
            ...this.loadWorkCenterState() // Load persisted state
        };
    }

    static saveState(state: WorkCenterState): void {
        try {
            const stateToSave = {
                currentPrompt: state.currentPrompt,
                autoAction: state.autoAction,
                selectedInstruction: state.selectedInstruction,
                outputFormat: state.outputFormat,
                activeInputTab: state.activeInputTab,
                activeResultsTab: state.activeResultsTab,
                selectedLanguage: state.selectedLanguage,
                selectedTemplate: state.selectedTemplate,
                recognitionFormat: state.recognitionFormat,
                processingFormat: state.processingFormat,
                currentProcessingStep: state.currentProcessingStep,
                // Save metadata about recognized/processed data, not the full content
                recognizedData: state.recognizedData ? {
                    timestamp: state.recognizedData.timestamp,
                    source: state.recognizedData.source,
                    contentLength: state.recognizedData.content.length,
                    metadata: state.recognizedData.metadata
                } : null,
                processedData: state.processedData ? state.processedData.map(p => ({
                    timestamp: p.timestamp,
                    action: p.action,
                    contentLength: p.content.length,
                    metadata: p.metadata
                })) : null,
                // Don't save files, voiceRecording, or full content
            };
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(stateToSave));
        } catch (e) {
            console.warn("Failed to save workcenter state:", e);
        }
    }

    private static loadWorkCenterState(): Partial<WorkCenterState> {
        try {
            const saved = localStorage.getItem(this.STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                return {
                    currentPrompt: parsed.currentPrompt || "",
                    autoAction: parsed.autoAction || false,
                    selectedInstruction: parsed.selectedInstruction || "",
                    outputFormat: parsed.outputFormat || "auto",
                    activeInputTab: ((): WorkCenterState["activeInputTab"] => {
                        const tab = String(parsed.activeInputTab || "prompt");
                        return tab === "attachments" || tab === "prompt" ? tab : "prompt";
                    })(),
                    activeResultsTab: ((): WorkCenterState["activeResultsTab"] => {
                        const tab = String(parsed.activeResultsTab || "output");
                        return tab === "pipeline" || tab === "history" || tab === "output" ? tab : "output";
                    })(),
                    selectedLanguage: parsed.selectedLanguage || "auto",
                    selectedTemplate: parsed.selectedTemplate || "",
                    recognitionFormat: parsed.recognitionFormat || "auto",
                    processingFormat: parsed.processingFormat || "markdown",
                    currentProcessingStep: parsed.currentProcessingStep || 0,
                    // Don't restore full content, just metadata
                };
            }
        } catch (e) {
            console.warn("Failed to load workcenter state:", e);
        }
        return {};
    }

    static loadPromptTemplates(): { name: string, prompt: string }[] {
        const safeJsonParse = <T>(raw: string | null, fallback: T): T => {
            if (!raw) return fallback;
            try {
                const v = JSON.parse(raw) as T;
                return v ?? fallback;
            } catch {
                return fallback;
            }
        };

        return safeJsonParse(localStorage.getItem(this.TEMPLATES_STORAGE_KEY), [
            { name: "Analyze & Extract", prompt: "Analyze the provided content and extract key information, formulas, data, and insights. Identify the main topics, recognize any mathematical expressions or equations, and provide a structured summary." },
            { name: "Solve Equations", prompt: "Find and solve any mathematical equations, problems, or calculations in the content. Show your work step-by-step and provide the final answers." },
            { name: "Generate Code", prompt: "Based on the description or requirements in the content, generate appropriate code. Include comments and explain the implementation." },
            { name: "Extract Styles", prompt: "Analyze the visual content or design description and extract/generate CSS styles, color schemes, and layout information." },
            { name: "Document Analysis", prompt: "Perform a comprehensive analysis of the document, including structure, key points, relationships, and actionable insights." },
            { name: "Data Processing", prompt: "Process and transform the provided data. Extract structured information, identify patterns, and present results in a clear format." }
        ]);
    }

    static savePromptTemplates(templates: { name: string, prompt: string }[]): void {
        try {
            localStorage.setItem(this.TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
        } catch (e) {
            console.warn("Failed to save prompt templates:", e);
        }
    }

    static clearRecognizedData(state: WorkCenterState): void {
        state.recognizedData = null;
        state.processedData = null;
        state.currentProcessingStep = 0;
    }

    static addProcessedStep(state: WorkCenterState, step: { content: string; timestamp: number; action: string; sourceData: any; metadata?: any }): void {
        if (!state.processedData) {
            state.processedData = [];
        }
        state.processedData.push(step);
        state.currentProcessingStep++;
    }
}