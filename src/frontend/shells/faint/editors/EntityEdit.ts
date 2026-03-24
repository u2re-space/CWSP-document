import type { EntityInterface, TimeType } from "@rs-com/template/EntityInterface";
import type { EntityDescriptor } from "@rs-core/utils/Types";
import { scheduleFrame } from "@rs-core/utils/Runtime";
import { removeFile, writeFile } from "fest/lure";
import { H, Q, M } from "fest/lure";
import { observe, stringRef, propRef } from "fest/object";

// helpful imports (all from `@rs-core/template/*`, such as `EntityUtils`, `EntityId`, etc.)
import { detectEntityTypeByJSON } from "@rs-com/template/EntityUtils";
import { generateEntityId, fixEntityId, type EntityLike } from "@rs-com/template/EntityId";
import { JSOX } from "jsox";

// field editors
import { DateEntryEdit } from "./fields/DateEdit";
import { DescriptionEdit } from "./fields/DescriptionEdit";
import { InputListEdit } from "./fields/InputListEdit";
import { SelectEdit } from "./fields/SelectEdit";

//
export const objectExcludeNotExists = (object: any) => {
    if (!object) return object;
    if (typeof object == "object" || typeof object == "function") {
        return Object.fromEntries([...Object.entries(object)].filter(([key, value]) => value !== null && value !== undefined));
    }
    return object;
};

//
export const makePath = (entityItem: EntityInterface<any, any>, entityDesc: EntityDescriptor) => {
    const fileId = entityItem?.id || entityItem?.name;
    return (entityItem as any)?.__path || `${entityDesc.DIR}${(fileId || entityItem?.title)?.toString?.()?.toLowerCase?.()?.replace?.(/\s+/g, '-')?.replace?.(/[^a-z0-9_\-+#&]/g, '-')}.json`;
}

//
export type EntityEditOptions = {
    allowLinks?: boolean;
    description?: string;
    submitLabel?: string;
    initialLinks?: string[] | string;
    onLinksChange?: (links: string[]) => void;
    entityType?: string;
    autoGenerateId?: boolean;
    validateEntity?: boolean;
};

//
interface FieldConfig {
    key: string;
    label: string;
    type: "text" | "textarea" | "date" | "number" | "select" | "tags" | "list" | "phone" | "email" | "url" | "contacts";
    multiline?: boolean;
    options?: Array<{ value: string; label: string }>;
    format?: string;
    required?: boolean;
}

//
const GENERAL_FIELDS: FieldConfig[] = [
    { key: "id", label: "ID", type: "text", required: true },
    { key: "description", label: "Description", type: "textarea", multiline: true },
    { key: "title", label: "Title", type: "text" },
    { key: "name", label: "Name", type: "text" },
    { key: "tags", label: "Tags", type: "tags" },
];

//
const PROPERTIES_FIELD_CONFIGS_BY_TYPE: Record<string, FieldConfig[]> = {
    task: [
        {
            key: "status",
            label: "Status",
            type: "select",
            options: [
                { value: "pending", label: "Pending" },
                { value: "in-progress", label: "In Progress" },
                { value: "completed", label: "Completed" },
                { value: "cancelled", label: "Cancelled" },
                { value: "on-hold", label: "On Hold" },
            ]
        },
        { key: "begin_time", label: "Begin Time", type: "date" },
        { key: "end_time", label: "End Time", type: "date" },
        { key: "location", label: "Location", type: "text" },
        { key: "contacts", label: "Contacts", type: "contacts" }
    ],
    event: [
        { key: "begin_time", label: "Begin Time", type: "date" },
        { key: "end_time", label: "End Time", type: "date" },
        { key: "location", label: "Location", type: "text" },
        { key: "contacts", label: "Contacts", type: "contacts" }
    ],
    person: [
        { key: "home", label: "Home", type: "text" },
        { key: "biography", label: "Biography", type: "textarea", multiline: true },
        { key: "contacts", label: "Contacts", type: "contacts" }
    ],
    service: [
        { key: "location", label: "Location", type: "text" },
        { key: "contacts", label: "Contacts", type: "contacts" }
    ],
    item: [
        { key: "price", label: "Price", type: "number" },
        { key: "quantity", label: "Quantity", type: "number" }
    ],
    skill: [
        { key: "level", label: "Level", type: "text" }
    ],
};

//
const getFieldsForType = (type: string): FieldConfig[] => {
    return PROPERTIES_FIELD_CONFIGS_BY_TYPE[type] //|| FIELD_CONFIGS_BY_TYPE.task;
};

//
const validateField = (value: any, config: FieldConfig): boolean => {
    if (config.required && (!value || (typeof value === "string" && !value.trim()))) {
        return false;
    }
    return true;
};

//
const createFieldElement = (entityItem: any, config: FieldConfig) => {
    const key = config.key;

    // Use specialized editors for certain field types
    if (config.type === "date") {
        return DateEntryEdit({ object: entityItem, key });
    }

    if (config.type === "textarea" || config.key === "description") {
        return DescriptionEdit({ object: entityItem, key });
    }

    if (config.type === "phone" || config.type === "email" || config.type === "url") {
        return InputListEdit({ object: entityItem, key }, { label: config.label, type: config.type });
    }

    if (config.type === "tags") {
        entityItem[key] = entityItem[key] || [];
        return InputListEdit({ object: entityItem, key, parts: entityItem[key] }, { label: "Tag", type: "text" });
    }

    if (config.type === "contacts") {
        entityItem[key] = entityItem[key] || {};
        const contactsObj = entityItem[key];

        contactsObj.email = contactsObj.email || [];
        contactsObj.phone = contactsObj.phone || [];
        contactsObj.links = contactsObj.links || [];

        const emailEditor = InputListEdit({ object: contactsObj, key: "email", parts: contactsObj.email }, { label: "Email", type: "email" });
        const phoneEditor = InputListEdit({ object: contactsObj, key: "phone", parts: contactsObj.phone }, { label: "Phone", type: "phone" });
        const linksEditor = InputListEdit({ object: contactsObj, key: "links", parts: contactsObj.links }, { label: "Link", type: "url" });

        const block = H`<div class="modal-field modal-field-contacts" data-key=${key}>
            <label class="label">${config.label}</label>
            <div class="contacts-group">
                ${emailEditor.block}
                ${phoneEditor.block}
                ${linksEditor.block}
            </div>
        </div>`;

        return { block, saveEvent: null };
    }

    // Select field
    if (config.type === "select" && config.options) {
        return SelectEdit({ object: entityItem, key }, {
            options: config.options as { value: string; label: string }[],
            label: config.label,
            required: config.required
        });
    }

    // Simple input fields
    const inputRef = Q(($input) => $input);
    const fieldValue = stringRef(entityItem[key] || "");

    const inputType = config.type === "number" ? "number" : "text";
    const block = H`<div class="modal-field" data-key=${key}>
        <label class="label" for=${key}>${config.label}${config.required ? " *" : ""}</label>
        <input
            ref=${inputRef}
            type=${inputType}
            name=${key}
            prop:value=${fieldValue}
            data-multiline=${config.multiline ? "true" : "false"}
            id=${key}
        />
    </div>`;

    const saveEvent = () => {
        entityItem[key] = config.type === "number" ? Number(inputRef.value) : inputRef.value;
    };

    inputRef?.addEventListener("change", saveEvent);
    inputRef?.addEventListener("input", saveEvent);

    return { block, saveEvent };
};

//
export const makeEntityEdit = async (
    entityItem: EntityInterface<any, any>,
    entityDesc: EntityDescriptor,
    options: EntityEditOptions = {}
) => {
    // Create reactive copy of entity item (but work with plain object for editors)
    const editableEntity: any = { ...entityItem };
    const editableEntityProperties: any = { ...entityItem.properties };

    // Auto-generate ID if needed
    if (options.autoGenerateId && !editableEntity.id) {
        editableEntity.id = generateEntityId(editableEntity.type || entityDesc.type);
    }

    // Get field configurations
    const propertiesFields = getFieldsForType(entityDesc.type || options.entityType || "task");

    // Create main (general) field elements
    const fieldElements = GENERAL_FIELDS?.map?.((config: FieldConfig) => {
        const fieldEditor = createFieldElement(editableEntity, config);
        return { config, ...fieldEditor };
    }) || [];

    // Create properties field elements
    fieldElements.push(...(propertiesFields?.map?.((config: FieldConfig) => {
        const fieldEditor = createFieldElement(editableEntityProperties, config);
        return { config, ...fieldEditor };
    }) || []));

    // Create modal backdrop
    const backdropRef = Q(($backdrop) => $backdrop);
    const modalFormRef = Q(($form) => $form);

    // Validation state
    const validationErrors = observe<Record<string, string>>({});

    // Group fields by section
    const generalFieldEls = fieldElements?.slice?.(0, GENERAL_FIELDS?.length || 0);
    const propertyFieldEls = fieldElements?.slice?.(GENERAL_FIELDS?.length || 0);

    // Modal content
    const modalContent = H`<div class="rs-modal-backdrop" ref=${backdropRef}>
        <form class="modal-form" ref=${modalFormRef}>
            <header class="modal-header">
                <h2 class="modal-title">Edit ${entityDesc.label || "Entity"}</h2>
                ${options.description ? H`<p class="modal-description">${options.description}</p>` : null}
            </header>

            <div class="modal-fields">
                <section class="modal-section">
                    <h3 class="modal-section-title">General Information</h3>
                    <div class="modal-section-fields">
                        ${M(generalFieldEls, (fieldEl) => fieldEl.block)}
                    </div>
                </section>

                ${propertyFieldEls?.length > 0 ? H`<section class="modal-section">
                    <h3 class="modal-section-title">${entityDesc.label || "Entity"} Details</h3>
                    <div class="modal-section-fields">
                        ${M(propertyFieldEls, (fieldEl) => fieldEl.block)}
                    </div>
                </section>` : null}
            </div>

            <footer class="modal-actions">
                <div class="modal-actions-left">
                    <button type="button" class="btn cancel" data-action="cancel">Cancel</button>
                </div>
                <div class="modal-actions-right">
                    <button type="button" class="btn save" data-action="save">${options.submitLabel || "Save"}</button>
                </div>
            </footer>
        </form>
    </div>`;

    // Mount modal to document body
    document.body.appendChild(modalContent);

    // Prevent form submission
    modalFormRef?.addEventListener("submit", (ev: Event) => {
        ev.preventDefault();
    });

    // Return promise that resolves when modal is closed
    return new Promise((resolve, reject) => {
        const handleSave = async (ev?: Event) => {
            ev?.preventDefault();

            // Validate all fields
            let isValid = true;
            for (const { config } of fieldElements) {
                if (!validateField(editableEntity[config.key], config)) {
                    validationErrors[config.key] = `${config.label} is required`;
                    isValid = false;
                }
            }

            if (!isValid) {
                console.warn("Validation errors:", validationErrors);
                return;
            }

            // Save all fields (saveEvent can have different signatures, so handle errors)
            for (const { saveEvent } of fieldElements) {
                try {
                    if (saveEvent) {
                        // Try calling with no args first (simple fields)
                        // Some fields (DateEdit, DescriptionEdit, InputListEdit) may expect args
                        // but we skip explicit saves since they handle it internally via events
                        (saveEvent as any)();
                    }
                } catch (e) {
                    // Field editors handle their own saves via events, so this is expected
                    console.debug("Field auto-save handled:", e);
                }
            }

            // Merge properties back into entity
            editableEntity.properties = objectExcludeNotExists(editableEntityProperties);

            // Write to file
            try {
                const path = makePath(editableEntity as EntityInterface<any, any>, entityDesc);
                const jsonData = JSOX.stringify(editableEntity, undefined, 2) as any;
                await writeFile(null, path, jsonData);

                // Update original entity
                Object.assign(entityItem, editableEntity);

                // Close modal
                modalContent?.remove();
                resolve(editableEntity as EntityInterface<any, any>);
            } catch (error) {
                console.error("Failed to save entity:", error);
                reject(error);
            }
        };

        const handleCancel = () => {
            modalContent?.remove();
            resolve(null);
        };

        // Event delegation for modal actions
        modalContent?.addEventListener("click", (ev: Event) => {
            const target = ev.target as HTMLElement;
            const closestEl = target?.closest?.("[data-action]") as HTMLElement | null;
            const action = target?.dataset?.action || closestEl?.dataset?.action;

            if (action === "save") {
                handleSave();
            } else if (action === "cancel") {
                handleCancel();
            }
        });

        // Close on backdrop click
        backdropRef?.addEventListener("click", (ev: Event) => {
            if (ev.target === backdropRef) {
                handleCancel();
            }
        });

        // Close on Escape key
        const handleEscape = (ev: KeyboardEvent) => {
            if (ev.key === "Escape") {
                handleCancel();
                document.removeEventListener("keydown", handleEscape);
            }
        };
        document.addEventListener("keydown", handleEscape);
    });
}

//
export const makeEvents = (
    entityItem: EntityInterface<any, any>,
    entityDesc: EntityDescriptor) => {
    return {
        doDelete: async (ev: Event) => {
            ev?.stopPropagation?.();
            const scheduleIdle = (cb: IdleRequestCallback) => {
                if (typeof globalThis.requestIdleCallback === "function") {
                    return globalThis.requestIdleCallback(cb);
                }
                return setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 0);
            };
            scheduleIdle(async () => {
                const path = makePath(entityItem, entityDesc);
                try { await removeFile(null, path); } catch (e) { console.warn(e); }
                const card = (ev?.target as HTMLElement)?.closest?.(`.card[data-id="${entityItem?.id || entityItem?.name}"]`);
                card?.remove?.();
            });
        },
        doEdit: async (ev: Event) => {
            ev?.stopPropagation?.();
            scheduleFrame(async () => {
                // Open entity editor modal
                try {
                    const updatedEntity = await makeEntityEdit(entityItem, entityDesc, {
                        description: `Edit ${entityDesc.label} information`,
                        submitLabel: "Save Changes",
                        validateEntity: true,
                    });

                    // If entity was updated, refresh the card in the UI
                    if (updatedEntity) {
                        const entityAny = updatedEntity as any;
                        const card = (ev?.target as HTMLElement)?.closest?.(`.card[data-id="${entityAny?.id || entityAny?.name}"]`);
                        if (card) {
                            (card as any)?.$updateInfo?.(entityAny);

                            // Update card content
                            const titleEl = (card as any)?.querySelector('.card-title');
                            if (titleEl && entityAny.title) titleEl.textContent = entityAny.title;

                            const nameEl = (card as any)?.querySelector('.card-name');
                            if (nameEl && entityAny.name) nameEl.textContent = entityAny.name;

                            const descEl = (card as any)?.querySelector('.card-description');
                            if (descEl && entityAny.description) {
                                const desc = Array.isArray(entityAny.description)
                                    ? entityAny.description.join('\n')
                                    : entityAny.description;
                                descEl.textContent = desc;
                            }
                        }
                    }
                } catch (error) {
                    console.error("Failed to edit entity:", error);
                }
            });
        }
    }
}
