import { H } from "fest/lure";

export const createSettingsFooter = () => H`<footer class="settings-screen__footer">
        <button class="btn primary" type="button" data-action="save">Save</button>
        <span class="note" data-note></span>
    </footer>` as HTMLElement;
