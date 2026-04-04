import { M, H, Q } from "fest/lure";
import { stringRef } from "fest/object";

//
const editBindings = new WeakMap<any, FieldWithKey>();
const whichUsed = new WeakMap<any, ObjectAndKey>();

//
interface FieldWithKey {
    key: string;
    field: any;
}

//
interface ObjectAndKey {
    object?: any | null;
    key?: string | null;
}

//
interface SelectOption {
    value: string;
    label: string;
}

//
interface SelectConfig {
    options: SelectOption[];
    label?: string;
    required?: boolean;
    placeholder?: string;
}

//
export const SelectEdit = ({ object, key }: ObjectAndKey, config: SelectConfig) => {
    if (!key || !object) return { block: null, saveEvent: () => { } };

    const {
        options = [],
        label = "Select",
        required = false,
        placeholder
    } = config;

    // Validate options
    if (!options || options.length === 0) {
        console.warn(`SelectEdit: No options provided for field "${key}"`);
        return { block: null, saveEvent: () => { } };
    }

    //
    const selectRef = Q(($select) => $select);
    const initialValue = object[key] || options[0]?.value || "";
    const fieldValue = stringRef(initialValue);

    //
    const block = H`<div class="modal-field" data-key=${key} data-type="select">
        <label class="label" for=${key}>${label}${required ? " *" : ""}</label>
        <select
            ref=${selectRef}
            name=${key}
            prop:value=${fieldValue}
            id=${key}
            data-required=${required}
        >
            ${placeholder ? H`<option value="" disabled>${placeholder}</option>` : null}
            ${M(options, (opt) => H`<option value=${opt.value} selected=${opt.value === initialValue}>${opt.label}</option>`)}
        </select>
    </div>`;

    //
    const saveEvent = () => {
        if (selectRef && object && key) {
            object[key] = selectRef.value;
        }
    };

    //
    selectRef?.addEventListener("change", (ev) => {
        saveEvent();
        fieldValue.value = selectRef.value;
    });

    //
    whichUsed.set(block, { key, object });
    editBindings.set(object, { key, field: new WeakRef(block) });

    return { block, saveEvent };
};

//
export default SelectEdit;