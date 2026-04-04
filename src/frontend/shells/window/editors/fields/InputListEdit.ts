// similar to DescriptorEdit, but use input[type="@N"]
import { computed, isObservable, observe, propRef } from "fest/object";
import { H, M, Q } from "fest/lure";
import { JSOX } from "jsox";
import { canParseURL } from "@rs-core/utils/Runtime";

//
const editBindings = new WeakMap<any, FieldWithKey>();
const whichUsed = new WeakMap<any, ObjectAndKey>();

//
interface FieldWithKey {
    key: string;
    field: any;
};

//
interface ObjectAndKey {
    object?: any | null;
    key?: string | null;
    parts?: any[] | any;
};

//
interface FieldDescription {
    label: string;
    type: string;

    // custom format function
    format?: ((value: any) => any);
};

//
const HTMLInputTypeByVirtualType = new Map<string, string>();
HTMLInputTypeByVirtualType.set("phone", "tel");
HTMLInputTypeByVirtualType.set("email", "email");
HTMLInputTypeByVirtualType.set("url", "url");

//
const formattingRegistry = new Map<string, (value: any) => any>();
const formatPhoneString = (phone: string) => { return phone?.replace?.(/\+7/g, '8')?.replace?.(/\s+/g, '')?.replace?.(/[^0-9]/g, ''); }
const formatEmailString = (email: string) => { return email?.trim?.(); }
const formatUrlString = (url: string) => { return url?.trim?.(); }

// default formatting functions
formattingRegistry.set("phone", formatPhoneString);
formattingRegistry.set("email", formatEmailString);
formattingRegistry.set("url", formatUrlString);

//
const URL_BY_TYPE = (value: any, description: FieldDescription) => {
    switch (description?.type ?? "text") {
        case "phone":
            return `tel:${value}`;
        case "email":
            return `mailto:${value}`;
        case "url":
            return value;
    }
    return `https://${value}`;
}

//
const IS_URL = (value: any) => {
    if (canParseURL(value?.trim?.() || "")) return true;
    return (value.startsWith("http") || value.startsWith("//") || value.startsWith("www.") || value.startsWith("mailto:") || value.startsWith("tel:") || value.startsWith("https:") || value.startsWith("ftp:") || value.startsWith("file:") || value.startsWith("data:"));
}

//
const FORMAT_AS_URL = (value: any, description: FieldDescription) => {
    // needs protocol specifics...
    const un_url = (description?.format ?? formattingRegistry.get(description?.type ?? "text"))?.(value) ?? value;
    return IS_URL(un_url) ? un_url : URL_BY_TYPE(un_url, description);
};

// parts is value of object[key], and also can be interpreted as referenced object itself...
export const InputListEdit = ({ object, key, parts }: ObjectAndKey, description?: FieldDescription) => {
    if (!key && !parts) return { block: null, saveEvent: () => { } };

    //
    if (parts != null && (!isObservable(parts) || !Array.isArray(parts))) { parts = observe(!Array.isArray(parts) ? [parts] : parts); }
    parts ??= observe([]); const ars = parts;//wrapSetAsArray(parts);
    description ??= { label: "Part", type: "text" };

    // AI, remain as function, in future may be needed...
    const loadIfNotExists = () => {
        // if key is presented and object has key, and parts is empty, push the value to parts
        if (key != null && object?.[key] != null && ars?.length <= 0) {
            // TODO: make better idea...
            if (Array.isArray((object as any)[key])) {
                ars?.push(...(object as any)[key].map((item) => {
                    if (typeof item == "object" && (item != null || "value" in item)) { return item.value; } else
                        return String(item);
                }));
            } else
                if (typeof (object as any)[key] == "object" && ((object as any)[key] != null || "value" in (object as any)[key])) {
                    ars?.push((object as any)[key].value);
                } else
                ars?.push((object as any)[key]);
        }
    }

    //
    loadIfNotExists();

    //
    const onChangeEv = (ev: any) => {
        // alternatively, can be used index of child-list element...
        const rawValue = ev.target.value;
        const value = (description?.format ?? formattingRegistry.get(description?.type ?? "text"))?.(rawValue) ?? rawValue;
        saveEvent(value, parseInt(ev.target.dataset.index ?? "-1"));
    }

    // if parts is just string, when adding part changes to array of strings
    const onPreviewEv = (ev: any) => {
        if (ev.target.tagName == "A") {
            ev.target.href = FORMAT_AS_URL(ars[parseInt(ev.target.dataset.index ?? "-1") ?? 0], description);

            // DAMN, don't recurse and stuck browser to loops, if event is already is clicked...
            //ev.target.click();
        }
    }

    //
    const onCheckboxEv = (ev: any) => {
        // Checkbox state is already toggled by browser, just update parent container state
        if (ev.target.type === "checkbox") {
            const partContainer = ev.target.closest('.field-list-edit-part');
            if (partContainer) {
                partContainer.toggleAttribute('data-show-preview', ev.target.checked);
            }
        }
    }

    // add part event
    const addPartEvent = () => { ars.push(""); }; // remove part event
    const removePartEvent = (index: number) => { if (index >= 0 && index < ars.length) { ars.splice(index, 1); } }

    //
    const $partRender = (part, index) => {
        const refByIndex = propRef(ars, index);
        if (index < 0 || index == null || typeof index != "number" || part == null) return;

        const partName = "part-" + index;
        const block = H`<div class="field-list-edit-part" data-index=${index} style=${{ order: index, "--index": index }}>
            <input
                autocomplete="off"
                name=${partName}
                type=${HTMLInputTypeByVirtualType.get(description?.type ?? "text") ?? "text"}
                data-index=${index}
                data-format=${description?.type ?? "text"}
                on:change=${onChangeEv}
                prop:value=${(description?.format ?? formattingRegistry.get(description?.type ?? "text"))?.(part) ?? part}
            ></input>

            <button data-type="remove" data-index="${index}" type="button">x</button>
            <input type="checkbox" name=${"show-part-" + index} on:change=${onCheckboxEv} data-index=${index} data-type="show-password-or-url"></input>
            <label aria-hidden="true" for=${"part-" + index}>${description?.label ?? "Part"}</label>
            <a aria-hidden="true" ref=${aRefEl} on:click=${onPreviewEv} data-type="preview" data-index=${index} href=${computed(refByIndex, (v) => FORMAT_AS_URL(v, description))} target="_blank">${refByIndex}</a>

        </div>`

        block?.querySelector?.("button")?.addEventListener?.("click", (ev)=>{ removePartEvent(parseInt(ev.target.dataset.index ?? "-1")); });
        return block;
    };

    //
    const aRefEl = Q(($a) => $a);
    const block = H`<div class="field-list-edit" data-type=${description?.type ?? "text"}>
        <div class="field-list-edit-parts">${M(parts, $partRender)}</div>
        <button data-type="add" type="button" on:click=${(ev)=>addPartEvent?.()}>Add ${description?.label ?? "Part"}</button>
    </div>`;

    //
    const saveEvent = (value: any, index: number) => {
        // possible, reactive value or DOM element
        if (typeof value == "object" && (value != null || "value" in value)) { value = value.value; } else

        // possibly, JSON string
        if (typeof value == "object" && value != null) value = JSOX.stringify(value) as any;

        // debug input value and index
        console.log("saveEvent", value, index);

        // if multi-part
        if (index !== -1 && (Array.isArray(parts) || parts instanceof Set)) {
            if (typeof ars[index] == "string") { ars[index] = value; }
            if (typeof ars[index] == "object" && ars != null && (ars[index] != null || "value" in ars?.[index])) { ars[index].value = value; }
        } else
            // currently, no scenario, if index is -1 and parts is array, so...
            if (!Array.isArray(parts) && !(parts instanceof Set)) {
                if (typeof parts == "object" && (parts != null || "value" in parts)) {
                    parts.value = value;
                } else // we no able to reassign primitive value. So, save to object, if presented. Or we do nothing.
                    if (key != null) { object[key] = value; }
            }
    }

    //
    whichUsed.set(block, { key: key ?? "", object });
    editBindings.set(object, { key: key ?? "", field: new WeakRef(block) });
    return { block, saveEvent };
};
