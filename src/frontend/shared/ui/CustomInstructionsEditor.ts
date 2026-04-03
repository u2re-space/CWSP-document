import { H } from "fest/lure";
import { observe } from "fest/object";
import type { CustomInstruction } from "@rs-com/config/SettingsTypes";
import {
    getInstructionRegistry,
    addInstruction,
    addInstructions,
    updateInstruction,
    deleteInstruction,
    setActiveInstruction,
    DEFAULT_INSTRUCTION_TEMPLATES
} from "@rs-com/service/misc/CustomInstructions";

export type CustomInstructionsEditorOptions = {
    onUpdate?: () => void;
};

type EditorState = {
    instructions: CustomInstruction[];
    activeId: string;
    editingId: string | null;
    newLabel: string;
    newInstruction: string;
    isAdding: boolean;
};

export const createCustomInstructionsEditor = (opts: CustomInstructionsEditorOptions = {}): HTMLElement => {
    const state = observe<EditorState>({
        instructions: [],
        activeId: "",
        editingId: null,
        newLabel: "",
        newInstruction: "",
        isAdding: false
    });

    const root = H`<div class="custom-instructions-editor">
        <div class="ci-row">
            <div class="ci-header">
                <h4>Custom Instructions</h4>
                <p class="ci-desc">Define custom instructions for AI operations. These can be activated for "Recognize & Copy" and selected in the Work Center.</p>
            </div>

            <div class="ci-active-select">
                <label>
                    <span>Active instruction:</span>
                    <select class="ci-select" data-action="select-active">
                        <option value="">None (use default)</option>
                    </select>
                </label>
            </div>
        </div>

        <div class="ci-list" data-list></div>

        <div class="ci-add-form" data-add-form hidden>
            <input type="text" class="ci-input" data-field="label" placeholder="Instruction label..." />
            <textarea class="ci-textarea" data-field="instruction" placeholder="Enter your custom instruction..." rows="4"></textarea>
            <div class="ci-add-actions">
                <button class="btn small primary" type="button" data-action="save-new">Add</button>
                <button class="btn small" type="button" data-action="cancel-add">Cancel</button>
            </div>
        </div>

        <div class="ci-actions">
            <button class="btn small" type="button" data-action="add">+ Add Instruction</button>
            <button class="btn small" type="button" data-action="add-templates">Add Templates</button>
        </div>
    </div>` as HTMLElement;

    const listEl = root.querySelector("[data-list]") as HTMLElement;
    const selectEl = root.querySelector("[data-action='select-active']") as HTMLSelectElement;
    const addFormEl = root.querySelector("[data-add-form]") as HTMLElement;
    const labelInput = root.querySelector("[data-field='label']") as HTMLInputElement;
    const instructionInput = root.querySelector("[data-field='instruction']") as HTMLTextAreaElement;

    const renderList = () => {
        listEl.replaceChildren();

        if (!state.instructions.length) {
            listEl.append(H`<div class="ci-empty">No custom instructions. Add one or use templates.</div>` as HTMLElement);
            return;
        }

        for (const instr of state.instructions) {
            const isEditing = state.editingId === instr.id;
            const isActive = state.activeId === instr.id;

            const item = H`<div class="ci-item ${isActive ? "active" : ""}" data-id="${instr.id}">
                <div class="ci-item-header">
                    <span class="ci-item-label">${instr.label}</span>
                    <div class="ci-item-actions">
                        ${isActive
                            ? H`<span class="ci-badge active">Active</span>`
                            : H`<button class="btn tiny" type="button" data-action="activate">Use</button>`
                        }
                        <button class="btn tiny" type="button" data-action="edit">Edit</button>
                        <button class="btn tiny danger" type="button" data-action="delete">×</button>
                    </div>
                </div>
                ${isEditing
                    ? H`<div class="ci-edit-form">
                        <input type="text" class="ci-input" data-edit-field="label" value="${instr.label}" />
                        <textarea class="ci-textarea" data-edit-field="instruction" rows="4">${instr.instruction}</textarea>
                        <div class="ci-edit-actions">
                            <button class="btn small primary" type="button" data-action="save-edit">Save</button>
                            <button class="btn small" type="button" data-action="cancel-edit">Cancel</button>
                        </div>
                    </div>`
                    : H`<div class="ci-item-preview">${truncate(instr.instruction, 120)}</div>`
                }
            </div>` as HTMLElement;

            item.addEventListener("click", (e) => {
                const target = e.target as HTMLElement;
                const action = target.closest("[data-action]")?.getAttribute("data-action");

                if (action === "activate") {
                    void setActiveInstruction(instr.id)
                        .then(loadData)
                        .then(() => opts.onUpdate?.());
                }

                if (action === "edit") {
                    state.editingId = instr.id;
                    renderList();
                }

                if (action === "delete") {
                    if (confirm(`Delete "${instr.label}"?`)) {
                        void deleteInstruction(instr.id)
                            .then(loadData)
                            .then(() => opts.onUpdate?.());
                    }
                }

                if (action === "save-edit") {
                    const labelEl = item.querySelector("[data-edit-field='label']") as HTMLInputElement;
                    const instrEl = item.querySelector("[data-edit-field='instruction']") as HTMLTextAreaElement;

                    void updateInstruction(instr.id, {
                        label: labelEl.value.trim() || instr.label,
                        instruction: instrEl.value.trim()
                    }).then(() => {
                        state.editingId = null;
                        return loadData();
                    }).then(() => opts.onUpdate?.());
                }

                if (action === "cancel-edit") {
                    state.editingId = null;
                    renderList();
                }
            });

            listEl.append(item);
        }
    };

    const updateSelect = () => {
        selectEl.replaceChildren();
        selectEl.append(H`<option value="">None (use default)</option>` as HTMLOptionElement);

        for (const instr of state.instructions) {
            const opt = H`<option value="${instr.id}">${instr.label}</option>` as HTMLOptionElement;
            if (instr.id === state.activeId) opt.selected = true;
            selectEl.append(opt);
        }
    };

    const truncate = (text: string, maxLen: number): string => {
        if (!text || text.length <= maxLen) return text || "";
        return text.slice(0, maxLen).trim() + "…";
    };

    const loadData = async () => {
        const snapshot = await getInstructionRegistry();
        state.instructions = snapshot.instructions;
        state.activeId = snapshot.activeId;
        renderList();
        updateSelect();
    };

    root.addEventListener("click", (e) => {
        const target = e.target as HTMLElement;
        const action = target.closest("[data-action]")?.getAttribute("data-action");

        if (action === "add") {
            state.isAdding = true;
            addFormEl.hidden = false;
            labelInput.value = "";
            instructionInput.value = "";
            labelInput.focus();
        }

        if (action === "cancel-add") {
            state.isAdding = false;
            addFormEl.hidden = true;
        }

        if (action === "save-new") {
            const label = labelInput.value.trim();
            const instruction = instructionInput.value.trim();

            if (!instruction) {
                instructionInput.focus();
                return;
            }

            void addInstruction(label || "Custom", instruction).then((newInstr) => {
                if (!newInstr) return;
                state.isAdding = false;
                addFormEl.hidden = true;
                return loadData();
            }).then(() => opts.onUpdate?.());
        }

        if (action === "add-templates") {
            const existingLabels = new Set(state.instructions.map(i => i.label.trim().toLowerCase()));
            const templatesToAdd = DEFAULT_INSTRUCTION_TEMPLATES.filter(t => !existingLabels.has(t.label.trim().toLowerCase()));

            if (!templatesToAdd.length) {
                alert("All templates are already added.");
                return;
            }

            // Use bulk add to avoid race conditions
            addInstructions(templatesToAdd.map(t => ({
                label: t.label,
                instruction: t.instruction,
                enabled: t.enabled
            }))).then(loadData).then(() => opts.onUpdate?.());
        }
    });

    selectEl.addEventListener("change", () => {
        const newActiveId = selectEl.value || "";
        void setActiveInstruction(newActiveId || null)
            .then(loadData)
            .then(() => opts.onUpdate?.());
    });

    void loadData();

    return root;
};
