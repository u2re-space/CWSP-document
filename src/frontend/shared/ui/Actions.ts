import type { EntityDescriptor } from "@rs-core/utils/Types";
import { LongPressHandler, H } from "fest/lure";
import { labelsPerAction, actionRegistry, iconsPerAction } from "@rs-core/utils/Actions";

//
const generateActionButton = (action: string, entityDesc: EntityDescriptor, viewPage?: any) => {
    let altAction: any = null;
    if (action === "generate") {
        altAction = "record-speech-recognition";
    }

    //
    const button = H`<button type="button" style="touch-action: none;" on:click=${(e: any) => actionRegistry.get(action)?.(e, entityDesc, viewPage)}>
        <ui-icon icon=${iconsPerAction.get(action)}></ui-icon>
        <span>${labelsPerAction.get(action)?.(entityDesc)}</span>
    </button>`;

    //
    if (altAction) {
        new LongPressHandler(button, {
            minHoldTime: 180,
            maxHoldTime: 200,
            maxOffsetRadius: 10,
            anyPointer: true,
            mouseImmediate: false,
        }, (e: any) => actionRegistry.get(altAction)?.(e, entityDesc, viewPage));
    }

    //
    return button;
}

//
export const makeActions = (actions: string[], entityDesc: EntityDescriptor, viewPage?: any) => {
    return actions.map((action) => generateActionButton(action, entityDesc, viewPage));
}

//
export const makeToolbar = (actions: string[], entityDesc: EntityDescriptor, forView: any)=>{
    return H`<div slot="bar" class="view-toolbar"><div class="button-set">${makeActions(actions, entityDesc, forView)}</div></div>`
}
