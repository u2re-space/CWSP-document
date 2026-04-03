import { observableByMap, observableBySet } from "fest/object";
import { H, M } from "fest/lure";
import { beginDragAsText, buildPrimaryDayTitle, buildSecondaryDayTitle, isNotEmpty, copyEmailClick, copyPhoneClick } from "@rs-core/text";


//
export const formatTextElement = (text: string) => {
    const normalized = text?.trim?.();
    if (!normalized) return null;
    return H`<span draggable="true" data-action="copy-text" class="text">${normalized}</span>`;
}

//
export const formatEmailElement = (email: string) => {
    const normalized = email?.trim?.();
    if (!normalized) return null;
    return H`<a on:dragstart=${beginDragAsText} draggable="true" data-action="copy-email" class="email" href="mailto:${normalized}" on:click=${copyEmailClick}>${normalized}</a>`;
}


//
export const formatPhoneElement = (phone: string) => {
    let text = phone ?? "";
    text = text.replace(/\+7/g, '8').replace(/\s+/g, '').replace(/[^0-9]/g, '');
    text = text.replace(/\(/g, '').replace(/\)/g, '');
    text = text.replace(/\s+/g, '').replace(/[^0-9]/g, '');
    const normalized = text.trim();
    if (!normalized) return null;
    return H`<a on:dragstart=${beginDragAsText} draggable="true" data-action="copy-phone" class="phone" href="tel:${normalized}" on:click=${copyPhoneClick}>${normalized}</a>`;
}

//
export const wrapAsListItem = (label: string | any, item: any) => {
    if (!item) return null;
    if (label) {
        return H`<li><span class="item-label">${label}</span>: ${item}</li>`;
    }
    return H`<li>${item}</li>`;
}


export const makeDayHeader = (dayDesc: any, onToggle: (ev: Event) => void) => {
    const primary = buildPrimaryDayTitle(dayDesc);
    const secondary = buildSecondaryDayTitle(dayDesc, primary);
    return H`<header class="timeline-day-header" on:click=${onToggle}>
        <div class="timeline-day-divider"><span>${primary}</span></div>
        ${secondary ? H`<p class="timeline-day-meta">${secondary}</p>` : null}
    </header>`;
};


//
export const formatLocation = (location: any) => {
    if (location?.address)
        return H`<span class="location">${renderAddress(location.address)}</span>`;
}

//
export const formatBiography = (biography: any) => {
    return H`<span class="biography">${biography.firstName?.join?.(" ") || ((biography.firstName || "") + " ")} ${biography.lastName?.join?.(" ") || ((biography.lastName || "") + " ")} ${biography.nickName?.join?.(" ") || ((biography.nickName || "") + " ")}</span>`;
}


//
export const renderAddress = (address: any) => {
    if (typeof address == "string") return H`<span class="address">${address}</span>`;

    //
    const parts: any[] = [];
    if (address?.street)
        parts.push(H`<span class="address street">${address.street}</span>`);
    if (address?.square)
        parts.push(H`<span class="address square">${address.square}</span>`);
    if (address?.house)
        parts.push(H`<span class="address house">${address.house}</span>`);
    if (address?.flat)
        parts.push(H`<span class="address flat">${address.flat}</span>`);
    if (address?.floor)
        parts.push(H`<span class="address floor">${address.floor}</span>`);
    if (address?.room)
        parts.push(H`<span class="address room">${address.room}</span>`);

    //
    return parts;
}



//
export const listFormatter = (label: string | any, text: string | string[] | Set<any> | any[] | Map<any, any>, formatter: (frag: any) => any) => {
    if (Array.isArray(text)) {
        const collection = text.map?.((frag: any) => formatter(frag))?.filter(Boolean);
        return collection?.length ? wrapAsListItem(label, M(collection, (item: any) => item)) : null;
    }
    if (text instanceof Map) {
        const mapped = M(observableByMap(text), (frag: any) => formatter(frag));
        return wrapAsListItem(label, mapped);
    }
    if (text instanceof Set) {
        const mapped = M(observableBySet(text), (frag: any) => formatter(frag));
        return wrapAsListItem(label, mapped);
    }
    return wrapAsListItem(label, formatter(text));
}

//
export const formatTextList = (label: string | any, text: string | string[] | Set<any> | any[] | Map<any, any>) => {
    return listFormatter(label, text, formatTextElement);
};

//
export const formatEmailList = (label: string | any, emails: string | string[] | Set<any> | any[] | Map<any, any>) => {
    return listFormatter(label, emails, formatEmailElement);
}

//
export const formatPhoneList = (label: string | any, phones: string | string[] | Set<any> | any[] | Map<any, any>) => {
    return listFormatter(label, phones, formatPhoneElement);
}

//
export const formatBiographyList = (label: string | any, biography: any | any[] | Map<any, any>) => {
    return listFormatter(label, biography, formatBiography);
}

//
export const formatLocationList = (label: string | any, location: any | any[] | Map<any, any>) => {
    return listFormatter(label, location, formatLocation);
}

//
export const formatAsCode = (label, code)=>{

}

//
export const formatByCondition = (label: string | any, text: string | string[] | Set<any> | any[] | Map<any, any>, key: string | null = null) => {
    if (!text) return null;
    if (key == "begin_time" || key == "end_time" || key == "status") { return; }
    if (key == "phone") { return formatPhoneList(label || "Phone", text); }
    if (key == "email") { return formatEmailList(label || "Email", text); }
    if (key == "biography") { return formatBiographyList(label || "Biography", text); }
    if (key == "location") { return formatLocationList(label || "Location", text); }
    if (key == "code") { return formatAsCode(label || "Code", text); }

    //
    if (typeof text != "object") return formatTextList(label, text);
    if (typeof text == "object" && key && text?.[key] != null && typeof text?.[key] != "object") { return formatTextList(label, text?.[key]);; }

    //
    if (typeof text == "object") {
        return [...Object.entries(text)].map(([K, Sb]: any) => {
            return formatByCondition("", Sb, K || key);
        })?.filter?.((e: any) => e);
    }

    //
    return formatTextList(label, text);
}

//
export const makePropertyDesc = (label: string | any, property: any, key?: string | null) => {
    let basis = property;
    if (!isNotEmpty(basis)) return null;

    // handle lists, maps, sets, etc.
    return formatByCondition(label, basis, key);
}
