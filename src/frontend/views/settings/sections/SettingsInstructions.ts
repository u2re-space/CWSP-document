import { H } from "fest/lure";
import { createCustomInstructionsEditor } from "./CustomInstructionsEditor";

export const createInstructionsSection = (setNote: (text: string) => void) => H`<section class="card settings-tab-panel" data-tab-panel="instructions" data-section="instructions">
      <h3>Recognition Instructions</h3>
      <div data-custom-instructions="editor">
        ${createCustomInstructionsEditor({ onUpdate: () => setNote("Instructions updated.") })}
      </div>
    </section>` as HTMLElement;
