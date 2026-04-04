import { isObservable, observe } from "fest/object";
import { H, M } from "fest/lure";
import { JSOX } from "jsox";

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
export const DescriptionEdit = ({ object, key, parts }: ObjectAndKey) => {
    if (!key && !parts) return { block: null, saveEvent: () => { } };

    //
    if (parts != null && (!isObservable(parts) || !Array.isArray(parts))) { parts = observe(!Array.isArray(parts) ? [parts] : parts); }
    parts ??= observe([]) as string[];

    // AI, remain as function, in future may be needed...
    const loadIfNotExists = () => {
        // if key is presented and object has key, and parts is empty, push the value to parts
        if (key != null && object?.[key] != null && parts?.length <= 0) {
            // TODO: make better idea...
            if (Array.isArray((object as any)[key])) {
                parts?.push(...(object as any)[key].map((item) => {
                    if (typeof item == "object" && (item != null || "value" in item)) { return item.value; } else
                        return String(item);
                }));
            } else
                if (typeof (object as any)[key] == "object" && ((object as any)[key] != null || "value" in (object as any)[key])) {
                    parts?.push(object[key].value);
                } else
                    parts?.push(object[key]);
        }
    }

    //
    loadIfNotExists();

    //
    const onChangeEv = (ev: any) => {
        // alternatively, can be used index of child-list element...
        saveEvent(ev.target.value, parseInt(ev.target.dataset.index ?? "-1"));
    }

    //
    const $partRender = (part, index) => {
        if (index < 0 || index == null || typeof index != "number" || part == null) return;
        const refByIndex = part;//propRef(parts, index);
        return H`<div class="descriptor-edit-part" data-index=${index} style=${{ order: index, "--index": index }}><textarea name=${"part-" + index} on:change=${onChangeEv} prop:value=${refByIndex}></textarea></div>`
    }

    // if parts is just string, when adding part changes to array of strings
    const block = H`<div class="descriptor-edit">
        <div class="descriptor-edit-parts">${M(parts, $partRender)}</div>
        <button type="button" on:click=${(ev)=>addPartEvent?.()}>Add Part</button>
    </div>`

    //
    const saveEvent = (value: any, index: number) => {
        // possible, reactive value or DOM element
        if (typeof value == "object" && (value != null || "value" in value)) { value = value.value; } else

        // possibly, JSON string
        if (typeof value == "object" && value != null) value = JSOX.stringify(value) as any;

        // debug input value and index
        console.log("saveEvent", value, index);

        // if multi-part
        if (index !== -1 && Array.isArray(parts)) {
            if (typeof parts[index] == "string") { parts[index] = value; }
            if (typeof parts[index] == "object" && (parts[index] != null || "value" in parts[index])) { parts[index].value = value; }
        } else
            // currently, no scenario, if index is -1 and parts is array, so...
            if (!Array.isArray(parts)) {
                if (typeof parts == "object" && (parts != null || "value" in parts)) {
                    parts.value = value;
                } else // we no able to reassign primitive value. So, save to object, if presented. Or we do nothing.
                    if (key != null) { object[key] = value; }
            }
    }

    // add part event
    const addPartEvent = () => { parts.push(""); }

    // remove part event
    const removePartEvent = (index: number) => { if (index >= 0 && index < parts.length) { parts.splice(index, 1); } }

    //
    block?.addEventListener("click", (ev) => {
        if (ev.target.tagName == "TEXTAREA") {
            saveEvent(ev.target.value, parseInt(ev.target.dataset.index ?? "-1"));
        }
    });

    //
    whichUsed.set(block, { key: key ?? "", object });
    editBindings.set(object, { key: key ?? "", field: new WeakRef(block) });
    return { block, saveEvent, addPartEvent };
};

//
export default DescriptionEdit;
