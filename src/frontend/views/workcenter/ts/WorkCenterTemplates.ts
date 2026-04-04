import { H } from "fest/lure";
import type { WorkCenterState, WorkCenterDependencies } from "./WorkCenterState";
import {
    getCustomInstructions,
    getInstructionRegistry,
    setActiveInstruction,
    DEFAULT_INSTRUCTION_TEMPLATES,
    buildInstructionPrompt
} from "@rs-com/service/instructions/CustomInstructions";
import type { CustomInstruction } from "@rs-com/config/SettingsTypes";

export class WorkCenterTemplates {
    private deps: WorkCenterDependencies;

    /** Cached custom instructions from settings */
    private cachedInstructions: CustomInstruction[] = [];
    private cachedActiveInstructionId = "";

    constructor(dependencies: WorkCenterDependencies) {
        this.deps = dependencies;
    }

    // ────────────────────────────────────────
    // Custom Instructions (from settings)
    // ────────────────────────────────────────

    /** Load custom instructions from app settings */
    async loadInstructions(): Promise<CustomInstruction[]> {
        try {
            const snapshot = await getInstructionRegistry();
            this.cachedInstructions = snapshot.instructions;
            this.cachedActiveInstructionId = snapshot.activeId;
            return this.cachedInstructions;
        } catch (e) {
            console.warn("[WorkCenterTemplates] Failed to load custom instructions:", e);
            return [];
        }
    }

    /** Get cached instructions (sync, call loadInstructions first) */
    getInstructions(): CustomInstruction[] {
        return this.cachedInstructions;
    }

    /** Get cached active instruction id from settings */
    getActiveInstructionId(): string {
        return this.cachedActiveInstructionId;
    }

    /** Get the currently active instruction from settings */
    async getActiveInstruction(): Promise<CustomInstruction | null> {
        if (this.cachedActiveInstructionId) {
            const cached = this.getInstructionById(this.cachedActiveInstructionId);
            if (cached) return cached;
        }
        const snapshot = await getInstructionRegistry();
        this.cachedInstructions = snapshot.instructions;
        this.cachedActiveInstructionId = snapshot.activeId;
        return snapshot.activeInstruction;
    }

    /** Set a specific instruction as active in settings */
    async setActiveInstruction(id: string | null): Promise<void> {
        await setActiveInstruction(id);
        this.cachedActiveInstructionId = id || "";
    }

    /** Build a combined prompt with the selected custom instruction */
    buildPromptWithInstruction(basePrompt: string, instruction: CustomInstruction | null): string {
        if (!instruction?.instruction) return basePrompt;
        return buildInstructionPrompt(basePrompt, instruction.instruction);
    }

    /** Get a specific instruction by ID */
    getInstructionById(id: string): CustomInstruction | undefined {
        return this.cachedInstructions.find(i => i.id === id);
    }

    /** Resolve selected instruction, fallback to active settings instruction */
    resolveInstruction(selectedId: string): CustomInstruction | null {
        if (selectedId) {
            const selected = this.getInstructionById(selectedId);
            if (selected) return selected;
        }
        if (!this.cachedActiveInstructionId) return null;
        return this.getInstructionById(this.cachedActiveInstructionId) || null;
    }

    /** Get default instruction templates (for seeding) */
    getDefaultTemplates(): Omit<CustomInstruction, "id">[] {
        return DEFAULT_INSTRUCTION_TEMPLATES;
    }

    renderInstructionPanel(state: WorkCenterState): string {
        return `
            <div class="instruction-panel">
              <div class="instruction-selector-row wide">
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
              <div class="instruction-help">
                Active instruction from Settings is appended to your prompt.
              </div>
            </div>
        `;
    }

    // ────────────────────────────────────────
    // Prompt Templates (WorkCenter-local)
    // ────────────────────────────────────────

    showTemplateEditor(state: WorkCenterState, container: HTMLElement): void {
        const modal = H`<div class="template-editor-modal">
      <div class="modal-content">
        <div class="modal-header">
            <h3>Prompt Templates</h3>
            <p class="modal-desc">Manage prompt templates used in Work Center. These define what action to perform on the content.</p>
        </div>
        ${this.renderInstructionPanel(state)}
        <div class="template-list">
          ${state.promptTemplates.map((template, index) =>
            H`<div class="template-item" data-index="${index}">
              <div class="template-item-header">
                <input type="text" class="template-name" value="${template.name}" data-index="${index}" placeholder="Template name...">
                <button class="btn small btn-danger remove-template" data-index="${index}" title="Remove template">
                  <ui-icon icon="trash" size="14"></ui-icon>
                </button>
              </div>
              <textarea class="template-prompt" data-index="${index}" rows="3" placeholder="Enter prompt template...">${template.prompt}</textarea>
            </div>`
        )}
        </div>
        <div class="modal-actions">
          <div class="modal-actions-group modal-actions-group-start">
            <button class="btn" data-action="add-template">
              <ui-icon icon="plus" size="14"></ui-icon>
              <span>Add Template</span>
            </button>
            <button class="btn" data-action="import-instructions" title="Import from Custom Instructions (Settings)">
              <ui-icon icon="download" size="14"></ui-icon>
              <span>Import from Settings</span>
            </button>
          </div>
          <div class="modal-actions-group modal-actions-group-end">
            <button class="btn primary" data-action="save-templates">Save</button>
            <button class="btn" data-action="close-editor">Close</button>
          </div>
        </div>
      </div>
    </div>` as HTMLElement;

        // Template editor events
        modal.addEventListener('click', async (e) => {
            const target = e.target as HTMLElement;
            const action = target.closest("[data-action]")?.getAttribute("data-action");
            const index = target.closest("[data-index]")?.getAttribute("data-index");

            if (action === 'add-template') {
                this.addTemplate(state);
                modal.remove();
                this.showTemplateEditor(state, container);
            } else if (action === 'save-templates') {
                await this.saveTemplates(state, modal);
                modal.remove();
                this.deps.render?.();
            } else if (action === 'close-editor') {
                modal.remove();
            } else if (action === 'import-instructions') {
                await this.importFromCustomInstructions(state);
                modal.remove();
                this.showTemplateEditor(state, container);
            } else if (target.classList.contains('remove-template') && index) {
                this.removeTemplate(state, parseInt(index));
                modal.remove();
                this.showTemplateEditor(state, container);
            }
        });

        // Close on backdrop click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        container.append(modal);
    }

    private addTemplate(state: WorkCenterState): void {
        state.promptTemplates.push({ name: 'New Template', prompt: 'Enter your prompt here...' });
    }

    private removeTemplate(state: WorkCenterState, index: number): void {
        if (index >= 0 && index < state.promptTemplates.length) {
            state.promptTemplates.splice(index, 1);
        }
    }

    private async saveTemplates(state: WorkCenterState, modal: HTMLElement): Promise<void> {
        // Update templates from inputs
        const nameInputs = modal.querySelectorAll('.template-name');
        const promptInputs = modal.querySelectorAll('.template-prompt');

        state.promptTemplates = Array.from(nameInputs).map((input, i) => ({
            name: (input as HTMLInputElement).value,
            prompt: (promptInputs[i] as HTMLTextAreaElement).value
        }));

        // Save to localStorage
        const { WorkCenterStateManager } = await import('./WorkCenterState');
        WorkCenterStateManager.savePromptTemplates(state.promptTemplates);

        this.deps.showMessage?.('Templates saved');
    }

    /**
     * Import custom instructions from app settings as prompt templates.
     * Maps each CustomInstruction into the WorkCenter template format.
     */
    private async importFromCustomInstructions(state: WorkCenterState): Promise<void> {
        try {
            const instructions = await getCustomInstructions();
            if (!instructions.length) {
                this.deps.showMessage?.('No custom instructions found in Settings');
                return;
            }

            const existingNames = new Set(state.promptTemplates.map(t => t.name));
            let added = 0;

            for (const instr of instructions) {
                if (!existingNames.has(instr.label)) {
                    state.promptTemplates.push({
                        name: instr.label,
                        prompt: instr.instruction
                    });
                    added++;
                }
            }

            // Persist
            const { WorkCenterStateManager } = await import('./WorkCenterState');
            WorkCenterStateManager.savePromptTemplates(state.promptTemplates);

            if (added > 0) {
                this.deps.showMessage?.(`Imported ${added} instruction${added > 1 ? 's' : ''} as templates`);
            } else {
                this.deps.showMessage?.('All instructions already exist as templates');
            }
        } catch (e) {
            console.warn("[WorkCenterTemplates] Failed to import instructions:", e);
            this.deps.showMessage?.('Failed to import instructions');
        }
    }

    selectTemplate(state: WorkCenterState, prompt: string): void {
        state.selectedTemplate = prompt;
        // Always apply the selected template - templates provide structured prompts
        // Users can modify them after selection if needed
        if (prompt) {
            state.currentPrompt = prompt;
        }
    }

    getTemplateByPrompt(state: WorkCenterState, prompt: string): { name: string, prompt: string } | undefined {
        return state.promptTemplates.find(t => t.prompt === prompt);
    }

    hasTemplate(state: WorkCenterState, prompt: string): boolean {
        return state.promptTemplates.some(t => t.prompt === prompt);
    }
}
