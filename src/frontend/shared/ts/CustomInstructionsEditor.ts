import {
    addInstruction,
    getCustomInstructions,
    setActiveInstruction,
    updateInstruction,
    type CustomInstruction,
} from "@rs-com/service/instructions/CustomInstructions";

export type CustomInstructionsEditorOptions = {
    onUpdate?: () => void;
};

export function createCustomInstructionsEditor(options: CustomInstructionsEditorOptions = {}): HTMLElement {
    const root = document.createElement("div");
    root.className = "custom-instructions-editor";

    const select = document.createElement("select");
    select.className = "form-select";
    select.setAttribute("aria-label", "Instruction template");

    const textarea = document.createElement("textarea");
    textarea.className = "form-input";
    textarea.rows = 8;
    textarea.placeholder = "Enter custom recognition instructions...";

    const save = document.createElement("button");
    save.type = "button";
    save.className = "btn";
    save.textContent = "Save instruction";

    let items: CustomInstruction[] = [];
    let activeId = "";

    const renderSelect = () => {
        select.replaceChildren();
        for (const item of items) {
            const option = document.createElement("option");
            option.value = item.id;
            option.textContent = item.label || "Untitled";
            select.append(option);
        }
        select.value = activeId;
    };

    const syncTextarea = () => {
        const current = items.find((item) => item.id === activeId);
        textarea.value = current?.instruction || "";
    };

    const init = async () => {
        items = await getCustomInstructions();
        if (!items.length) {
            await addInstruction("Default", "");
            items = await getCustomInstructions();
        }
        activeId = items[0]?.id || "";
        renderSelect();
        syncTextarea();
    };

    select.addEventListener("change", async () => {
        activeId = select.value;
        await setActiveInstruction(activeId || null);
        syncTextarea();
    });

    save.addEventListener("click", async () => {
        if (!activeId) return;
        await updateInstruction(activeId, { instruction: textarea.value || "" });
        options.onUpdate?.();
    });

    root.append(select, textarea, save);
    void init();
    return root;
}
