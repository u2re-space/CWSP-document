import type { WorkCenterState, WorkCenterDependencies } from "./WorkCenterState";
import type { WorkCenterTemplates } from "./WorkCenterTemplates";
import type { WorkCenterVoice } from "./WorkCenterVoice";
import type { CustomInstruction } from "@rs-com/config/SettingsTypes";

export class WorkCenterPrompts {
    private container: HTMLElement | null = null;
    private deps: WorkCenterDependencies;
    private templates: WorkCenterTemplates;
    private voice: WorkCenterVoice;

    constructor(dependencies: WorkCenterDependencies, templates: WorkCenterTemplates, voice: WorkCenterVoice) {
        this.deps = dependencies;
        this.templates = templates;
        this.voice = voice;
    }

    setContainer(container: HTMLElement | null): void {
        this.container = container;
    }



    renderPromptPanel(state: WorkCenterState): string {
        return `
            <div class="prompt-panel">
              <div class="prompt-controls">
                <select class="template-select">
                  <option value="">Select Template...</option>
                  ${state.promptTemplates.map(t => `<option value="${t.prompt.replace(/"/g, '&quot;')}" ${state.selectedTemplate === t.prompt ? 'selected' : ''}>${t.name}</option>`).join('')}
                </select>
                <button class="btn btn-icon" data-action="edit-templates" title="Edit Templates">
                  <ui-icon icon="gear" size="18" icon-style="duotone"></ui-icon>
                  <span class="btn-text">Templates</span>
                </button>
                <button class="btn btn-icon prompt-attach-btn" data-action="select-files" title="Attach files">
                  <ui-icon icon="paperclip" size="18" icon-style="duotone"></ui-icon>
                  <span class="attach-count" data-prompt-file-count>${state.files.length}</span>
                </button>
              </div>

              <div class="prompt-input-group" data-prompt-dropzone data-dropzone="">
                <div class="prompt-input-overlay" data-prompt-drop-hint>
                  <ui-icon icon="paperclip" size="16" icon-style="duotone"></ui-icon>
                  <span>Drop files, links or text to attach</span>
                </div>
                <textarea
                  class="prompt-input"
                  placeholder="Describe what you want to do with the attached content... (or use voice input)"
                  rows="4"
                >${state.currentPrompt}</textarea>
              </div>

              <div class="prompt-actions">
                
                <button class="btn voice-btn ${state.voiceRecording ? 'recording' : ''}" data-action="voice-input">
                  <ui-icon icon="microphone" size="20" icon-style="duotone"></ui-icon>
                  ${state.voiceRecording ? 'Recording...' : 'Hold for Voice'}
                </button>
                <label class="auto-action-label" title="Auto-action (use last successful)">
                  <input type="checkbox" class="auto-action-checkbox" ${state.autoAction ? 'checked' : ''}>
                  <ui-icon icon="lightning-a" size="20" icon-style="duotone"></ui-icon>
                </label>
                <button class="btn primary action-btn" data-action="execute">
                  <ui-icon icon="brain" size="20" icon-style="duotone"></ui-icon>
                  <span class="btn-text">Process Content</span>
                </button>
                <button class="btn btn-icon clear-btn" data-action="clear-prompt" title="Clear Prompt">
                  <ui-icon icon="trash" size="18" icon-style="duotone"></ui-icon>
                </button>
              </div>
            </div>
        `;
    }

    // Backward-compatible section render (unused in tabbed UI)
    renderPromptsSection(state: WorkCenterState): string {
        return `
            <div class="prompts-section">
              ${this.renderPromptPanel(state)}
            </div>
        `;
    }

    /** Populate the instruction selector with custom instructions from settings */
    async populateInstructionSelect(state: WorkCenterState): Promise<void> {
        if (!this.container) return;
        const select = this.container.querySelector('.instruction-select') as HTMLSelectElement;
        if (!select) return;

        const instructions = await this.templates.loadInstructions();
        const hasStoredSelection = Boolean(state.selectedInstruction) && instructions.some(i => i.id === state.selectedInstruction);
        const selectedId = hasStoredSelection ? state.selectedInstruction : this.templates.getActiveInstructionId();
        select.innerHTML = '<option value="">None (default)</option>';

        for (const instr of instructions) {
            const opt = document.createElement('option');
            opt.value = instr.id;
            opt.textContent = instr.label;
            if (instr.id === selectedId) opt.selected = true;
            select.append(opt);
        }

        if ((!state.selectedInstruction || !hasStoredSelection) && selectedId) {
            state.selectedInstruction = selectedId;
        }
    }

    /** Update the instruction selector options (sync, after loadInstructions) */
    updateInstructionSelect(state: WorkCenterState): void {
        if (!this.container) return;
        const select = this.container.querySelector('.instruction-select') as HTMLSelectElement;
        if (!select) return;

        const instructions = this.templates.getInstructions();
        const hasStoredSelection = Boolean(state.selectedInstruction) && instructions.some(i => i.id === state.selectedInstruction);
        const selectedId = hasStoredSelection ? state.selectedInstruction : this.templates.getActiveInstructionId();
        select.innerHTML = '<option value="">None (default)</option>';

        for (const instr of instructions) {
            const opt = document.createElement('option');
            opt.value = instr.id;
            opt.textContent = instr.label;
            if (instr.id === selectedId) opt.selected = true;
            select.append(opt);
        }
    }

    /** Get the currently selected instruction object */
    getSelectedInstruction(state: WorkCenterState): CustomInstruction | null {
        if (!state.selectedInstruction) return null;
        return this.templates.getInstructionById(state.selectedInstruction) || null;
    }

    // Update prompt input value
    updatePromptInput(state: WorkCenterState): void {
        if (!this.container) return;
        const promptInput = this.container.querySelector('.prompt-input') as HTMLTextAreaElement;
        if (promptInput) {
            promptInput.value = state.currentPrompt;
        }
    }

    // Update template select
    updateTemplateSelect(state: WorkCenterState): void {
        if (!this.container) return;
        const templateSelect = this.container.querySelector('.template-select') as HTMLSelectElement;
        if (templateSelect) {
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
    }

    // Update voice button state
    updateVoiceButton(state: WorkCenterState): void {
        if (!this.container) return;
        const voiceBtn = this.container.querySelector('[data-action="voice-input"]') as HTMLButtonElement;
        if (voiceBtn) {
            voiceBtn.innerHTML = state.voiceRecording ? '<ui-icon icon="microphone" size="20" icon-style="duotone"></ui-icon> Recording...' : '<ui-icon icon="microphone" size="20" icon-style="duotone"></ui-icon> Hold for Voice';
            voiceBtn.classList.toggle('recording', state.voiceRecording);
        }
    }

    updatePromptFileCount(state: WorkCenterState): void {
        if (!this.container) return;
        const count = this.container.querySelector('[data-prompt-file-count]') as HTMLElement | null;
        if (count) {
            count.textContent = String(state.files.length);
        }
    }

    // Clear prompt
    clearPrompt(state: WorkCenterState): void {
        state.currentPrompt = '';
        this.updatePromptInput(state);
    }

    // Handle template selection
    handleTemplateSelection(state: WorkCenterState, selectedPrompt: string): void {
        state.selectedTemplate = selectedPrompt;

        // Always apply the selected template - templates provide structured prompts
        // Users can modify them after selection if needed
        if (selectedPrompt) {
            state.currentPrompt = selectedPrompt;
            this.updatePromptInput(state);
        }
    }

    // Handle instruction selection
    handleInstructionSelection(state: WorkCenterState, instructionId: string): void {
        state.selectedInstruction = instructionId;
    }

    // Handle auto action toggle
    handleAutoActionToggle(state: WorkCenterState, checked: boolean): void {
        state.autoAction = checked;
    }
}
