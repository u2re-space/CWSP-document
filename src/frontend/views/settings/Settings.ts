//@ts-ignore
import style from "./Settings.scss?inline";

import { H } from "fest/lure";
import { loadSettings, saveSettings } from "@rs-com/config/Settings";
import { BUILTIN_AI_MODELS, type AppSettings, type MCPConfig } from "@rs-com/config/SettingsTypes";
import { applyTheme } from "@rs-core/utils/Theme";
import { setString, StorageKeys } from "../../../core/storage";
import { navigateToView } from "../../shells/main/routing";
import { createCustomInstructionsEditor } from "../../shared/ui/CustomInstructionsEditor";
import { loadAsAdopted } from "fest/dom";

export type SettingsViewOptions = {
    isExtension: boolean;
    initialTab?: string;
    onTheme?: (theme: AppSettings["appearance"] extends { theme?: infer T } ? (T extends string ? T : "auto") : "auto") => void;
};

const SUPPORTED_SPEECH_LANGUAGES = ["en", "ru", "en-GB", "en-US"] as const;
type SupportedSpeechLanguage = (typeof SUPPORTED_SPEECH_LANGUAGES)[number];

const speechLanguageLabel = (lang: SupportedSpeechLanguage): string => {
    if (lang === "en") return "English (generic)";
    if (lang === "ru") return "Russian";
    if (lang === "en-GB") return "English (UK)";
    return "English (US)";
};

const normalizeSpeechLanguage = (lang: string | undefined): SupportedSpeechLanguage | null => {
    const value = (lang || "").trim();
    if (!value) return null;
    if (value === "ru" || value.startsWith("ru-")) return "ru";
    if (value === "en-GB") return "en-GB";
    if (value === "en-US") return "en-US";
    if (value === "en" || value.startsWith("en-")) return "en";
    return null;
};

const buildSpeechLanguageOptions = (): SupportedSpeechLanguage[] => {
    const ordered = new Set<SupportedSpeechLanguage>();
    const navLanguages = typeof navigator !== "undefined"
        ? [...(navigator.languages || []), navigator.language]
        : [];

    for (const navLanguage of navLanguages) {
        const normalized = normalizeSpeechLanguage(navLanguage);
        if (normalized) ordered.add(normalized);
    }
    for (const fallback of SUPPORTED_SPEECH_LANGUAGES) {
        ordered.add(fallback);
    }
    return Array.from(ordered);
};

const buildResponseLanguageOptions = (): string[] => {
    const baseline = ["ru", "en"];
    const ordered = new Set<string>(baseline);
    const navLanguages = typeof navigator !== "undefined"
        ? [...(navigator.languages || []), navigator.language]
        : [];

    for (const navLanguage of navLanguages) {
        const value = (navLanguage || "").trim();
        if (!value || value === "en" || value === "ru") continue;
        ordered.add(value);
    }

    return Array.from(ordered);
};

const parseNumberOrDefault = (value: string | undefined, fallback: number): number => {
    const parsed = Number((value || "").trim());
    if (!Number.isFinite(parsed)) return fallback;
    return parsed;
};
const parseFloatInRange = (value: string | undefined, fallback: number, min: number, max: number): number => {
    const parsed = Number.parseFloat((value || "").trim());
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
};

export const createSettingsView = (opts: SettingsViewOptions) => {
    loadAsAdopted(style)
    let note: HTMLElement | null = null;
    const setNote = (text: string) => {
        if (!note) return;
        note.textContent = text;
        if (text) setTimeout(() => (note && (note.textContent = "")), 1500);
    };

    const root = H`<div class="view-settings">

    <section class="actions">
        <div class="settings-tab-actions" data-settings-tabs data-active-tab="ai">
        <button class="settings-tab-btn" type="button" data-action="switch-settings-tab" data-tab="appearance" aria-selected="false">Appearance</button>
        <button class="settings-tab-btn" type="button" data-action="switch-settings-tab" data-tab="markdown" aria-selected="false">Markdown</button>
        <button class="settings-tab-btn is-active" type="button" data-action="switch-settings-tab" data-tab="ai" aria-selected="true">AI</button>
        <button class="settings-tab-btn" type="button" data-action="switch-settings-tab" data-tab="mcp" aria-selected="false">MCP</button>
        <button class="settings-tab-btn" type="button" data-action="switch-settings-tab" data-tab="instructions" aria-selected="false">Instructions</button>
        <button class="settings-tab-btn" type="button" data-action="switch-settings-tab" data-tab="extension" aria-selected="false" data-extension-tab hidden>Extension</button>
        <h2>Settings</h2>
        </div>
    </section>

    <section class="card settings-tab-panel" data-tab-panel="appearance">
      <h3>Appearance</h3>
      <label class="field">
        <span>Theme</span>
        <select class="form-select" data-field="appearance.theme">
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="auto">Auto</option>
        </select>
        <span>Font Size</span>
        <select class="form-select" data-field="appearance.fontSize">
          <option value="small">Small</option>
          <option value="medium">Medium</option>
          <option value="large">Large</option>
        </select>
      </label>
    </section>

    <section class="card settings-tab-panel" data-tab-panel="markdown">
      <h3>Markdown Viewer</h3>
      <label class="field">
        <span>Style preset</span>
        <select class="form-select" data-field="appearance.markdown.preset">
          <option value="default">Default</option>
          <option value="classic">Classic</option>
          <option value="compact">Compact</option>
          <option value="paper">Paper</option>
        </select>
      </label>
      <label class="field">
        <span>Font family</span>
        <select class="form-select" data-field="appearance.markdown.fontFamily">
          <option value="system">System UI</option>
          <option value="sans">Sans</option>
          <option value="serif">Serif</option>
          <option value="mono">Monospace</option>
        </select>
      </label>
      <label class="field">
        <span>Font size (px)</span>
        <input class="form-input" type="number" inputmode="numeric" min="12" max="26" step="1" data-field="appearance.markdown.fontSizePx" />
      </label>
      <label class="field">
        <span>Line height</span>
        <input class="form-input" type="number" inputmode="decimal" min="1.1" max="2.2" step="0.05" data-field="appearance.markdown.lineHeight" />
      </label>
      <label class="field">
        <span>Content max width (px)</span>
        <input class="form-input" type="number" inputmode="numeric" min="500" max="1400" step="10" data-field="appearance.markdown.contentMaxWidthPx" />
      </label>
      <label class="field">
        <span>Print scale</span>
        <input class="form-input" type="number" inputmode="decimal" min="0.5" max="1.5" step="0.05" data-field="appearance.markdown.printScale" />
      </label>
      <label class="field">
        <span>Page size</span>
        <select class="form-select" data-field="appearance.markdown.page.size">
          <option value="auto">Auto</option>
          <option value="A4">A4</option>
          <option value="Letter">Letter</option>
          <option value="Legal">Legal</option>
          <option value="A5">A5</option>
        </select>
      </label>
      <label class="field">
        <span>Page orientation</span>
        <select class="form-select" data-field="appearance.markdown.page.orientation">
          <option value="portrait">Portrait</option>
          <option value="landscape">Landscape</option>
        </select>
      </label>
      <label class="field">
        <span>Page margins (mm)</span>
        <input class="form-input" type="number" inputmode="numeric" min="5" max="40" step="1" data-field="appearance.markdown.page.marginMm" />
      </label>
      <h4>Style modules</h4>
      <p class="field-hint" style="margin: 0 0 0.5rem; opacity: 0.85; font-size: 0.9em;">Grouped by what they affect in the viewer. All are on by default.</p>
      <fieldset class="field-group" style="border: 0; padding: 0; margin: 0 0 1rem;">
        <legend class="field" style="font-weight: 600; margin-bottom: 0.35rem;">Type &amp; layout</legend>
        <label class="field checkbox form-checkbox">
          <input type="checkbox" data-field="appearance.markdown.modules.typography" />
          <span>Typography (paragraphs, headings)</span>
        </label>
        <label class="field checkbox form-checkbox">
          <input type="checkbox" data-field="appearance.markdown.modules.lists" />
          <span>Lists (bullets &amp; numbering)</span>
        </label>
      </fieldset>
      <fieldset class="field-group" style="border: 0; padding: 0; margin: 0 0 1rem;">
        <legend class="field" style="font-weight: 600; margin-bottom: 0.35rem;">Blocks &amp; media</legend>
        <label class="field checkbox form-checkbox">
          <input type="checkbox" data-field="appearance.markdown.modules.tables" />
          <span>Tables</span>
        </label>
        <label class="field checkbox form-checkbox">
          <input type="checkbox" data-field="appearance.markdown.modules.codeBlocks" />
          <span>Code blocks</span>
        </label>
        <label class="field checkbox form-checkbox">
          <input type="checkbox" data-field="appearance.markdown.modules.blockquotes" />
          <span>Blockquotes</span>
        </label>
        <label class="field checkbox form-checkbox">
          <input type="checkbox" data-field="appearance.markdown.modules.media" />
          <span>Images &amp; video</span>
        </label>
      </fieldset>
      <fieldset class="field-group" style="border: 0; padding: 0; margin: 0 0 1rem;">
        <legend class="field" style="font-weight: 600; margin-bottom: 0.35rem;">Print</legend>
        <label class="field checkbox form-checkbox">
          <input type="checkbox" data-field="appearance.markdown.modules.printBreaks" />
          <span>Print breaks (avoid splits inside headings, tables, …)</span>
        </label>
      </fieldset>
      <h4>Rendering plugins</h4>
      <label class="field checkbox form-checkbox">
        <input type="checkbox" data-field="appearance.markdown.plugins.smartTypography" />
        <span>Smart typography</span>
      </label>
      <label class="field checkbox form-checkbox">
        <input type="checkbox" data-field="appearance.markdown.plugins.softBreaksAsBr" />
        <span>Soft line breaks as BR</span>
      </label>
      <label class="field checkbox form-checkbox">
        <input type="checkbox" data-field="appearance.markdown.plugins.externalLinksNewTab" />
        <span>Open external links in new tab</span>
      </label>
      <label class="field">
        <span>Custom CSS (screen/view)</span>
        <textarea class="form-input" rows="8" data-field="appearance.markdown.customCss" placeholder=".markdown-viewer-content h1 { color: var(--color-primary); }"></textarea>
      </label>
      <label class="field">
        <span>Custom CSS (print only)</span>
        <textarea class="form-input" rows="8" data-field="appearance.markdown.printCss" placeholder=".markdown-viewer-content { font-size: 12pt; line-height: 1.5; }"></textarea>
      </label>
      <label class="field">
        <span>Markdown extensions (JSON rules)</span>
        <textarea class="form-input" rows="10" data-field="appearance.markdown.extensions" placeholder='[
  {
    "id": "highlight",
    "pattern": "==(.+?)==",
    "replacement": "<mark>$1</mark>",
    "flags": "g",
    "enabled": true
  }
]'></textarea>
      </label>
      <div class="mcp-actions">
        <button class="btn" type="button" data-action="open-user-styles">Open <code>/user/styles/</code> in Explorer</button>
        <button class="btn" type="button" data-action="open-assets-readonly">Open <code>/assets/</code> (read-only) in Explorer</button>
      </div>
      <p class="mcp-empty-note">Rules are regex replacements applied before markdown parsing. Invalid JSON is rejected on save. Custom CSS supports explicit <code>@layer</code> blocks for advanced interop.</p>
    </section>

    <section class="card settings-tab-panel is-active" data-tab-panel="ai">
      <h3>AI</h3>
      <label class="field">
        <span>Base URL</span>
        <input placeholder="https://api.proxyapi.ru/openai/v1" class="form-input" type="url" inputmode="url" autocomplete="off" data-field="ai.baseUrl" />
      </label>
      <label class="field">
        <span>API Key</span>
        <input placeholder="sk-..." class="form-input" type="password" autocomplete="off" data-field="ai.apiKey"/>
      </label>
      <label class="field checkbox form-checkbox">
        <input type="checkbox" data-field="ui.showKey" />
        <span>Show API key</span>
      </label>
      <label class="field">
        <span>Model</span>
        <select class="form-select" data-field="ai.model"></select>
      </label>
      <label class="field" data-field-group="ai.customModel">
        <span>Custom model identifier</span>
        <input placeholder="provider/model-or-id" class="form-input" type="text" autocomplete="off" data-field="ai.customModel"/>
      </label>
      <label class="field">
        <span>Default reasoning effort</span>
        <select class="form-select" data-field="ai.defaultReasoningEffort">
            <option value="none">None</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
        </select>
      </label>
      <details class="settings-spoiler" data-advanced-ai-spoiler>
        <summary>Advanced AI settings</summary>
        <div>
          
          <label class="field">
            <span>Default verbosity</span>
            <select class="form-select" data-field="ai.defaultVerbosity">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label class="field">
            <span>Max output tokens</span>
            <input placeholder="400000" class="form-input" type="number" inputmode="numeric" data-field="ai.maxOutputTokens" />
          </label>
          <label class="field">
            <span>Context truncation</span>
            <select class="form-select" data-field="ai.contextTruncation">
              <option value="disabled">Disabled</option>
              <option value="auto">Auto</option>
            </select>
          </label>
          <label class="field">
            <span>Prompt cache retention</span>
            <select class="form-select" data-field="ai.promptCacheRetention">
              <option value="in-memory">In-memory</option>
              <option value="24h">24h</option>
            </select>
          </label>
          <label class="field">
            <span>Max tool calls</span>
            <input placeholder="8" class="form-input" type="number" inputmode="numeric" data-field="ai.maxToolCalls" />
          </label>
          <label class="field checkbox form-checkbox">
            <input type="checkbox" data-field="ai.parallelToolCalls" />
            <span>Allow parallel tool calls</span>
          </label>
          <label class="field">
            <span>Timeout low (ms)</span>
            <input placeholder="60000" class="form-input" type="number" inputmode="numeric" data-field="ai.requestTimeout.low" />
          </label>
          <label class="field">
            <span>Timeout medium (ms)</span>
            <input placeholder="300000" class="form-input" type="number" inputmode="numeric" data-field="ai.requestTimeout.medium" />
          </label>
          <label class="field">
            <span>Timeout high (ms)</span>
            <input placeholder="900000" class="form-input" type="number" inputmode="numeric" data-field="ai.requestTimeout.high" />
          </label>
          <label class="field">
            <span>Max retries</span>
            <input placeholder="2" class="form-input" type="number" inputmode="numeric" data-field="ai.maxRetries" />
          </label>
        </div>
      </details>
      <label class="field">
        <span>Share target mode</span>
        <select class="form-select" data-field="ai.shareTargetMode">
          <option value="recognize">Recognize and copy</option>
          <option value="analyze">Analyze and store</option>
        </select>
      </label>
      <label class="field checkbox form-checkbox">
        <input type="checkbox" data-field="ai.autoProcessShared" />
        <span>Auto AI on Share Target / File Open (and copy to clipboard)</span>
      </label>
      <label class="field">
        <span>Response language</span>
        <select class="form-select" data-field="ai.responseLanguage"></select>
      </label>
      <label class="field checkbox form-checkbox">
        <input type="checkbox" data-field="ai.translateResults" />
        <span>Translate results</span>
      </label>
      <label class="field checkbox form-checkbox">
        <input type="checkbox" data-field="ai.generateSvgGraphics" />
        <span>Generate SVG graphics</span>
      </label>
      <label class="field">
        <span>Speech Recognition language</span>
        <select class="form-select" data-field="speech.language"></select>
      </label>
    </section>

    <section class="card settings-tab-panel" data-tab-panel="mcp">
      <h3>MCP</h3>
      <div class="mcp-section" data-mcp-section></div>
      <div class="mcp-actions">
        <button class="btn" type="button" data-action="add-mcp-server">Add MCP server</button>
      </div>
    </section>

    <section class="card settings-tab-panel" data-tab-panel="instructions" data-section="instructions">
      <h3>Recognition Instructions</h3>
      <div data-custom-instructions="editor">
        ${createCustomInstructionsEditor({ onUpdate: () => setNote("Instructions updated.") })}
      </div>
    </section>

    <section class="card settings-tab-panel" data-tab-panel="extension" data-section="extension" hidden>
      <h3>Extension</h3>
      <label class="field checkbox form-checkbox">
        <input type="checkbox" data-field="core.ntpEnabled" />
        <span>Enable New Tab Page (offline Basic)</span>
      </label>
    </section>
    <div class="settings-header">
        <button class="btn primary" type="button" data-action="save">Save</button><span class="note" data-note></span>
    </div>
  </div>` as HTMLElement;

    const field = (sel: string) => root.querySelector(sel) as HTMLInputElement | HTMLSelectElement | null;
    note = root.querySelector("[data-note]") as HTMLElement | null;

    const apiUrl = field('[data-field="ai.baseUrl"]') as HTMLInputElement | null;
    const apiKey = field('[data-field="ai.apiKey"]') as HTMLInputElement | null;
    const showKey = field('[data-field="ui.showKey"]') as HTMLInputElement | null;
    const model = field('[data-field="ai.model"]') as HTMLSelectElement | null;
    const customModel = field('[data-field="ai.customModel"]') as HTMLInputElement | null;
    const customModelGroup = root.querySelector('[data-field-group="ai.customModel"]') as HTMLElement | null;
    const defaultReasoningEffort = field('[data-field="ai.defaultReasoningEffort"]') as HTMLSelectElement | null;
    const defaultVerbosity = field('[data-field="ai.defaultVerbosity"]') as HTMLSelectElement | null;
    const maxOutputTokens = field('[data-field="ai.maxOutputTokens"]') as HTMLInputElement | null;
    const contextTruncation = field('[data-field="ai.contextTruncation"]') as HTMLSelectElement | null;
    const promptCacheRetention = field('[data-field="ai.promptCacheRetention"]') as HTMLSelectElement | null;
    const maxToolCalls = field('[data-field="ai.maxToolCalls"]') as HTMLInputElement | null;
    const parallelToolCalls = field('[data-field="ai.parallelToolCalls"]') as HTMLInputElement | null;
    const requestTimeoutLow = field('[data-field="ai.requestTimeout.low"]') as HTMLInputElement | null;
    const requestTimeoutMedium = field('[data-field="ai.requestTimeout.medium"]') as HTMLInputElement | null;
    const requestTimeoutHigh = field('[data-field="ai.requestTimeout.high"]') as HTMLInputElement | null;
    const maxRetries = field('[data-field="ai.maxRetries"]') as HTMLInputElement | null;
    const mode = field('[data-field="ai.shareTargetMode"]') as HTMLSelectElement | null;
    const syncCustomModelVisibility = () => {
        const isCustom = (model?.value || "").trim() === "custom";
        if (customModelGroup) customModelGroup.hidden = !isCustom;
        if (customModel) customModel.disabled = !isCustom;
    };

    if (model) {
        model.replaceChildren();
        for (const builtInModel of BUILTIN_AI_MODELS) {
            const option = document.createElement("option");
            option.value = builtInModel;
            option.textContent = builtInModel;
            model.append(option);
        }
        const customOption = document.createElement("option");
        customOption.value = "custom";
        customOption.textContent = "Custom...";
        model.append(customOption);
        model.addEventListener("change", syncCustomModelVisibility);
    }
    customModel?.addEventListener("focus", () => {
        if (!model) return;
        model.value = "custom";
        syncCustomModelVisibility();
    });

    const autoProcessShared = field('[data-field="ai.autoProcessShared"]') as HTMLInputElement | null;
    const responseLanguage = field('[data-field="ai.responseLanguage"]') as HTMLSelectElement | null;
    const translateResults = field('[data-field="ai.translateResults"]') as HTMLInputElement | null;
    const generateSvgGraphics = field('[data-field="ai.generateSvgGraphics"]') as HTMLInputElement | null;
    const speechLanguage = field('[data-field="speech.language"]') as HTMLSelectElement | null;
    const theme = field('[data-field="appearance.theme"]') as HTMLSelectElement | null;
    const fontSize = field('[data-field="appearance.fontSize"]') as HTMLSelectElement | null;
    const markdownPreset = field('[data-field="appearance.markdown.preset"]') as HTMLSelectElement | null;
    const markdownFontFamily = field('[data-field="appearance.markdown.fontFamily"]') as HTMLSelectElement | null;
    const markdownFontSizePx = field('[data-field="appearance.markdown.fontSizePx"]') as HTMLInputElement | null;
    const markdownLineHeight = field('[data-field="appearance.markdown.lineHeight"]') as HTMLInputElement | null;
    const markdownContentMaxWidthPx = field('[data-field="appearance.markdown.contentMaxWidthPx"]') as HTMLInputElement | null;
    const markdownPrintScale = field('[data-field="appearance.markdown.printScale"]') as HTMLInputElement | null;
    const markdownPageSize = field('[data-field="appearance.markdown.page.size"]') as HTMLSelectElement | null;
    const markdownPageOrientation = field('[data-field="appearance.markdown.page.orientation"]') as HTMLSelectElement | null;
    const markdownPageMarginMm = field('[data-field="appearance.markdown.page.marginMm"]') as HTMLInputElement | null;
    const markdownModuleTypography = field('[data-field="appearance.markdown.modules.typography"]') as HTMLInputElement | null;
    const markdownModuleLists = field('[data-field="appearance.markdown.modules.lists"]') as HTMLInputElement | null;
    const markdownModuleTables = field('[data-field="appearance.markdown.modules.tables"]') as HTMLInputElement | null;
    const markdownModuleCodeBlocks = field('[data-field="appearance.markdown.modules.codeBlocks"]') as HTMLInputElement | null;
    const markdownModuleBlockquotes = field('[data-field="appearance.markdown.modules.blockquotes"]') as HTMLInputElement | null;
    const markdownModuleMedia = field('[data-field="appearance.markdown.modules.media"]') as HTMLInputElement | null;
    const markdownModulePrintBreaks = field('[data-field="appearance.markdown.modules.printBreaks"]') as HTMLInputElement | null;
    const markdownPluginSmartTypography = field('[data-field="appearance.markdown.plugins.smartTypography"]') as HTMLInputElement | null;
    const markdownPluginSoftBreaks = field('[data-field="appearance.markdown.plugins.softBreaksAsBr"]') as HTMLInputElement | null;
    const markdownPluginExternalLinks = field('[data-field="appearance.markdown.plugins.externalLinksNewTab"]') as HTMLInputElement | null;
    const markdownCustomCss = root.querySelector('[data-field="appearance.markdown.customCss"]') as HTMLTextAreaElement | null;
    const markdownPrintCss = root.querySelector('[data-field="appearance.markdown.printCss"]') as HTMLTextAreaElement | null;
    const markdownExtensions = root.querySelector('[data-field="appearance.markdown.extensions"]') as HTMLTextAreaElement | null;
    const ntpEnabled = field('[data-field="core.ntpEnabled"]') as HTMLInputElement | null;
    const mcpSection = root.querySelector("[data-mcp-section]") as HTMLElement | null;
    const extSection = root.querySelector('[data-section="extension"]') as HTMLElement | null;
    const extTab = root.querySelector('[data-extension-tab]') as HTMLButtonElement | null;

    if (responseLanguage) {
        responseLanguage.replaceChildren();
        const autoOption = document.createElement("option");
        autoOption.value = "auto";
        autoOption.textContent = "Auto-detect";
        responseLanguage.append(autoOption);

        const followOption = document.createElement("option");
        followOption.value = "follow";
        followOption.textContent = "Follow source/context";
        responseLanguage.append(followOption);

        for (const lang of buildResponseLanguageOptions()) {
            const option = document.createElement("option");
            option.value = lang;
            option.textContent = lang === "ru"
                ? "Russian"
                : lang === "en"
                    ? "English"
                    : lang;
            responseLanguage.append(option);
        }
    }

    if (speechLanguage) {
        speechLanguage.replaceChildren();
        for (const lang of buildSpeechLanguageOptions()) {
            const option = document.createElement("option");
            option.value = lang;
            option.textContent = speechLanguageLabel(lang);
            speechLanguage.append(option);
        }
    }

    const switchSettingsTab = (tab: string) => {
        const nextTab = tab || "ai";
        const tabRoot = root.querySelector('[data-settings-tabs]') as HTMLElement | null;
        tabRoot?.setAttribute("data-active-tab", nextTab);

        const tabButtons = root.querySelectorAll('[data-action="switch-settings-tab"][data-tab]');
        for (const tabButton of Array.from(tabButtons)) {
            const btn = tabButton as HTMLButtonElement;
            const isActive = btn.getAttribute("data-tab") === nextTab;
            btn.classList.toggle("is-active", isActive);
            btn.setAttribute("aria-selected", String(isActive));
        }

        const panels = root.querySelectorAll('[data-tab-panel]');
        for (const panel of Array.from(panels)) {
            const el = panel as HTMLElement;
            const isActive = el.getAttribute("data-tab-panel") === nextTab;
            if (el.hidden && isActive) continue;
            el.classList.toggle("is-active", isActive);
        }
    };

    const resolveInitialTab = (raw?: string): string => {
        const normalized = (raw || "").trim().toLowerCase();
        if (!normalized) return "ai";
        if (normalized === "style" || normalized === "styles" || normalized === "styling") return "markdown";
        const availableTabs = new Set(["appearance", "markdown", "ai", "mcp", "instructions", "extension"]);
        return availableTabs.has(normalized) ? normalized : "ai";
    };

    const openExplorerPath = (path: string) => {
        try {
            setString(StorageKeys.EXPLORER_PATH, path);
            navigateToView("explorer");
            const channel = new BroadcastChannel("file-explorer");
            channel.postMessage({
                type: "content-explorer",
                data: {
                    action: "view",
                    path
                }
            });
            channel.close();
            setNote(`Explorer: ${path}`);
        } catch (error) {
            console.warn("[Settings] Failed to open explorer path:", error);
            setNote("Failed to open Explorer path.");
        }
    };

    const createMcpRow = (cfg: MCPConfig) => {
        const safeCfg = {
            id: (cfg?.id || `mcp-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`).trim(),
            serverLabel: (cfg?.serverLabel || "").trim(),
            origin: (cfg?.origin || "").trim(),
            clientKey: (cfg?.clientKey || "").trim(),
            secretKey: (cfg?.secretKey || "").trim(),
        };

        return H`<div class="field mcp-row" data-mcp-id=${safeCfg.id}>
            <label class="field">
              <span>Server Label</span>
              <input class="form-input" type="text" data-mcp-field="serverLabel" autocomplete="off" value="${safeCfg.serverLabel}" />
            </label>
            <label class="field">
              <span>Origin</span>
              <input class="form-input" type="url" data-mcp-field="origin" autocomplete="off" placeholder="https://server.example" value="${safeCfg.origin}" />
            </label>
            <label class="field">
              <span>Client Key</span>
              <input class="form-input" type="text" data-mcp-field="clientKey" autocomplete="off" value="${safeCfg.clientKey}" />
            </label>
            <label class="field">
              <span>Secret Key</span>
              <input class="form-input" type="password" data-mcp-field="secretKey" autocomplete="off" placeholder="sk-..." value="${safeCfg.secretKey}" />
            </label>
            <button class="btn btn-danger" type="button" data-action="remove-mcp-server">Remove</button>
          </div>` as HTMLElement;
    };

    const collectMcpConfigurations = () => {
        if (!mcpSection) return [];
        const rows = Array.from(mcpSection.querySelectorAll<HTMLElement>("[data-mcp-id]"));
        const items: MCPConfig[] = [];

        for (const row of rows) {
            const id = row.getAttribute("data-mcp-id") || `mcp-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
            const serverLabel = row.querySelector<HTMLInputElement>('[data-mcp-field="serverLabel"]')?.value?.trim() || "";
            const origin = row.querySelector<HTMLInputElement>('[data-mcp-field="origin"]')?.value?.trim() || "";
            const clientKey = row.querySelector<HTMLInputElement>('[data-mcp-field="clientKey"]')?.value?.trim() || "";
            const secretKey = row.querySelector<HTMLInputElement>('[data-mcp-field="secretKey"]')?.value?.trim() || "";
            if (!serverLabel) continue;
            items.push({ id, serverLabel, origin, clientKey, secretKey });
        }
        return items;
    };

    const renderMcpConfigurations = (configs: MCPConfig[]) => {
        if (!mcpSection) return;
        mcpSection.replaceChildren();
        const list = Array.isArray(configs) ? configs : [];
        if (!list.length) {
            mcpSection.appendChild(H`<p class="mcp-empty-note">No MCP servers configured.</p>` as HTMLElement);
            return;
        }
        list.forEach((cfg) => mcpSection.appendChild(createMcpRow(cfg)));
    };

    void loadSettings()
        .then((s) => {
            if (apiUrl) apiUrl.value = (s?.ai?.baseUrl || "").trim();
            if (apiKey) apiKey.value = (s?.ai?.apiKey || "").trim();
            const savedModel = (s?.ai?.model || "gpt-5.4").trim();
            const savedCustomModel = (s?.ai?.customModel || "").trim();
            if (model) {
                const hasBuiltin = BUILTIN_AI_MODELS.includes(savedModel as (typeof BUILTIN_AI_MODELS)[number]);
                if (savedModel === "custom" || (!hasBuiltin && !!savedModel)) {
                    model.value = "custom";
                    if (customModel) customModel.value = savedCustomModel || savedModel;
                } else {
                    model.value = hasBuiltin ? savedModel : "gpt-5.4";
                    if (customModel) customModel.value = savedCustomModel;
                }
                syncCustomModelVisibility();
            }
            if (defaultReasoningEffort) defaultReasoningEffort.value = (s?.ai?.defaultReasoningEffort || "medium") as any;
            if (defaultVerbosity) defaultVerbosity.value = (s?.ai?.defaultVerbosity || "medium") as any;
            if (maxOutputTokens) maxOutputTokens.value = String(s?.ai?.maxOutputTokens ?? 400000);
            if (contextTruncation) contextTruncation.value = (s?.ai?.contextTruncation || "disabled") as any;
            if (promptCacheRetention) promptCacheRetention.value = (s?.ai?.promptCacheRetention || "in-memory") as any;
            if (maxToolCalls) maxToolCalls.value = String(s?.ai?.maxToolCalls ?? 8);
            if (parallelToolCalls) parallelToolCalls.checked = (s?.ai?.parallelToolCalls ?? true) !== false;
            if (requestTimeoutLow) requestTimeoutLow.value = String(s?.ai?.requestTimeout?.low ?? 60000);
            if (requestTimeoutMedium) requestTimeoutMedium.value = String(s?.ai?.requestTimeout?.medium ?? 300000);
            if (requestTimeoutHigh) requestTimeoutHigh.value = String(s?.ai?.requestTimeout?.high ?? 900000);
            if (maxRetries) maxRetries.value = String(s?.ai?.maxRetries ?? 2);
            if (mode) mode.value = (s?.ai?.shareTargetMode || "recognize") as any;
            if (autoProcessShared) autoProcessShared.checked = (s?.ai?.autoProcessShared ?? true) !== false;
            if (responseLanguage) responseLanguage.value = (s?.ai?.responseLanguage || "auto") as any;
            if (translateResults) translateResults.checked = Boolean(s?.ai?.translateResults);
            if (generateSvgGraphics) generateSvgGraphics.checked = Boolean(s?.ai?.generateSvgGraphics);
            if (speechLanguage) speechLanguage.value = (s?.speech?.language || "en-US") as any;
            if (theme) theme.value = (s?.appearance?.theme || "auto") as any;
            if (fontSize) fontSize.value = (s?.appearance?.fontSize || "medium") as any;
            if (markdownPreset) markdownPreset.value = (s?.appearance?.markdown?.preset || "default") as any;
            if (markdownFontFamily) markdownFontFamily.value = (s?.appearance?.markdown?.fontFamily || "system") as any;
            if (markdownFontSizePx) markdownFontSizePx.value = String(s?.appearance?.markdown?.fontSizePx ?? 16);
            if (markdownLineHeight) markdownLineHeight.value = String(s?.appearance?.markdown?.lineHeight ?? 1.7);
            if (markdownContentMaxWidthPx) markdownContentMaxWidthPx.value = String(s?.appearance?.markdown?.contentMaxWidthPx ?? 860);
            if (markdownPrintScale) markdownPrintScale.value = String(s?.appearance?.markdown?.printScale ?? 1);
            if (markdownPageSize) markdownPageSize.value = (s?.appearance?.markdown?.page?.size || "auto") as any;
            if (markdownPageOrientation) markdownPageOrientation.value = (s?.appearance?.markdown?.page?.orientation || "portrait") as any;
            if (markdownPageMarginMm) markdownPageMarginMm.value = String(s?.appearance?.markdown?.page?.marginMm ?? 12);
            if (markdownModuleTypography) markdownModuleTypography.checked = (s?.appearance?.markdown?.modules?.typography ?? true) !== false;
            if (markdownModuleLists) markdownModuleLists.checked = (s?.appearance?.markdown?.modules?.lists ?? true) !== false;
            if (markdownModuleTables) markdownModuleTables.checked = (s?.appearance?.markdown?.modules?.tables ?? true) !== false;
            if (markdownModuleCodeBlocks) markdownModuleCodeBlocks.checked = (s?.appearance?.markdown?.modules?.codeBlocks ?? true) !== false;
            if (markdownModuleBlockquotes) markdownModuleBlockquotes.checked = (s?.appearance?.markdown?.modules?.blockquotes ?? true) !== false;
            if (markdownModuleMedia) markdownModuleMedia.checked = (s?.appearance?.markdown?.modules?.media ?? true) !== false;
            if (markdownModulePrintBreaks) markdownModulePrintBreaks.checked = (s?.appearance?.markdown?.modules?.printBreaks ?? true) !== false;
            if (markdownPluginSmartTypography) markdownPluginSmartTypography.checked = Boolean(s?.appearance?.markdown?.plugins?.smartTypography);
            if (markdownPluginSoftBreaks) markdownPluginSoftBreaks.checked = Boolean(s?.appearance?.markdown?.plugins?.softBreaksAsBr);
            if (markdownPluginExternalLinks) markdownPluginExternalLinks.checked = (s?.appearance?.markdown?.plugins?.externalLinksNewTab ?? true) !== false;
            if (markdownCustomCss) markdownCustomCss.value = (s?.appearance?.markdown?.customCss || "").trim();
            if (markdownPrintCss) markdownPrintCss.value = (s?.appearance?.markdown?.printCss || "").trim();
            if (markdownExtensions) {
                const extensions = Array.isArray(s?.appearance?.markdown?.extensions)
                    ? s.appearance?.markdown?.extensions
                    : [];
                markdownExtensions.value = extensions.length > 0
                    ? JSON.stringify(extensions, null, 2)
                    : "";
            }
            if (ntpEnabled) ntpEnabled.checked = Boolean(s?.core?.ntpEnabled);
            renderMcpConfigurations(Array.isArray(s?.ai?.mcp) ? s.ai.mcp : []);
            opts.onTheme?.((theme?.value as any) || "auto");
        })
        .catch(() => {
            renderMcpConfigurations([]);
        });

    showKey?.addEventListener("change", () => {
        if (!apiKey || !showKey) return;
        apiKey.type = showKey.checked ? "text" : "password";
    });

    theme?.addEventListener("change", () => {
        opts.onTheme?.((theme.value as any) || "auto");
    });

    root.addEventListener("click", (e) => {
        const t = e.target as HTMLElement | null;
        const tabBtn = t?.closest?.('button[data-action="switch-settings-tab"]') as HTMLButtonElement | null;
        if (tabBtn) {
            switchSettingsTab(tabBtn.getAttribute("data-tab") || "ai");
            return;
        }

        const addMcpBtn = t?.closest?.('button[data-action="add-mcp-server"]') as HTMLButtonElement | null;
        if (addMcpBtn && mcpSection) {
            mcpSection.querySelector(".mcp-empty-note")?.remove();
            mcpSection.appendChild(createMcpRow({
                id: `mcp-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
                serverLabel: "",
                origin: "",
                clientKey: "",
                secretKey: "",
            }));
            return;
        }

        const removeMcpBtn = t?.closest?.('button[data-action="remove-mcp-server"]') as HTMLButtonElement | null;
        if (removeMcpBtn) {
            removeMcpBtn.closest(".mcp-row")?.remove();
            if (mcpSection && !mcpSection.querySelector("[data-mcp-id]")) {
                renderMcpConfigurations([]);
            }
            return;
        }

        const openUserStylesBtn = t?.closest?.('button[data-action="open-user-styles"]') as HTMLButtonElement | null;
        if (openUserStylesBtn) {
            openExplorerPath("/user/styles/");
            return;
        }

        const openAssetsReadonlyBtn = t?.closest?.('button[data-action="open-assets-readonly"]') as HTMLButtonElement | null;
        if (openAssetsReadonlyBtn) {
            openExplorerPath("/assets/");
            return;
        }

        const btn = t?.closest?.('button[data-action="save"]') as HTMLButtonElement | null;
        if (!btn) return;

        void (async () => {
            let parsedMarkdownExtensions: any[] = [];
            const rawExtensions = markdownExtensions?.value?.trim() || "";
            if (rawExtensions) {
                try {
                    const parsed = JSON.parse(rawExtensions);
                    if (!Array.isArray(parsed)) throw new Error("Markdown extensions JSON must be an array.");
                    parsedMarkdownExtensions = parsed;
                } catch (error) {
                    switchSettingsTab("markdown");
                    setNote((error as Error)?.message || "Invalid Markdown extensions JSON.");
                    return;
                }
            }

            const next: AppSettings = {
                ai: {
                    baseUrl: apiUrl?.value?.trim?.() || "",
                    apiKey: apiKey?.value?.trim?.() || "",
                    model: (model?.value || "gpt-5.4") as any,
                    customModel: model?.value === "custom" ? (customModel?.value?.trim?.() || "") : "",
                    defaultReasoningEffort: (defaultReasoningEffort?.value as any) || "medium",
                    defaultVerbosity: (defaultVerbosity?.value as any) || "medium",
                    maxOutputTokens: parseNumberOrDefault(maxOutputTokens?.value, 400000),
                    contextTruncation: (contextTruncation?.value as any) || "disabled",
                    promptCacheRetention: (promptCacheRetention?.value as any) || "in-memory",
                    maxToolCalls: parseNumberOrDefault(maxToolCalls?.value, 8),
                    parallelToolCalls: (parallelToolCalls?.checked ?? true) !== false,
                    requestTimeout: {
                        low: parseNumberOrDefault(requestTimeoutLow?.value, 60000),
                        medium: parseNumberOrDefault(requestTimeoutMedium?.value, 300000),
                        high: parseNumberOrDefault(requestTimeoutHigh?.value, 900000),
                    },
                    maxRetries: parseNumberOrDefault(maxRetries?.value, 2),
                    shareTargetMode: (mode?.value as any) || "recognize",
                    autoProcessShared: (autoProcessShared?.checked ?? true) !== false,
                    responseLanguage: (responseLanguage?.value as any) || "auto",
                    translateResults: Boolean(translateResults?.checked),
                    generateSvgGraphics: Boolean(generateSvgGraphics?.checked),
                    mcp: collectMcpConfigurations(),
                },
                speech: {
                    language: (speechLanguage?.value as any) || "en-US",
                },
                core: {
                    ntpEnabled: Boolean(ntpEnabled?.checked),
                },
                appearance: {
                    theme: (theme?.value as any) || "auto",
                    fontSize: (fontSize?.value as any) || "medium",
                    markdown: {
                        preset: (markdownPreset?.value as any) || "default",
                        fontFamily: (markdownFontFamily?.value as any) || "system",
                        fontSizePx: parseNumberOrDefault(markdownFontSizePx?.value, 16),
                        lineHeight: parseFloatInRange(markdownLineHeight?.value, 1.7, 1.1, 2.2),
                        contentMaxWidthPx: parseNumberOrDefault(markdownContentMaxWidthPx?.value, 860),
                        printScale: parseFloatInRange(markdownPrintScale?.value, 1, 0.5, 1.5),
                        page: {
                            size: (markdownPageSize?.value as any) || "auto",
                            orientation: (markdownPageOrientation?.value as any) || "portrait",
                            marginMm: parseNumberOrDefault(markdownPageMarginMm?.value, 12),
                        },
                        modules: {
                            typography: (markdownModuleTypography?.checked ?? true) !== false,
                            lists: (markdownModuleLists?.checked ?? true) !== false,
                            tables: (markdownModuleTables?.checked ?? true) !== false,
                            codeBlocks: (markdownModuleCodeBlocks?.checked ?? true) !== false,
                            blockquotes: (markdownModuleBlockquotes?.checked ?? true) !== false,
                            media: (markdownModuleMedia?.checked ?? true) !== false,
                            printBreaks: (markdownModulePrintBreaks?.checked ?? true) !== false,
                        },
                        plugins: {
                            smartTypography: Boolean(markdownPluginSmartTypography?.checked),
                            softBreaksAsBr: Boolean(markdownPluginSoftBreaks?.checked),
                            externalLinksNewTab: (markdownPluginExternalLinks?.checked ?? true) !== false
                        },
                        customCss: markdownCustomCss?.value || "",
                        printCss: markdownPrintCss?.value || "",
                        extensions: parsedMarkdownExtensions || []
                    }
                },
            };
            const saved = await saveSettings(next);
            applyTheme(saved);
            opts.onTheme?.((saved.appearance?.theme as any) || "auto");
            setNote("Saved.");
        })().catch((err) => setNote(String(err)));
    });

    if (opts.isExtension) {
        if (extSection) extSection.hidden = false;
        if (extTab) extTab.hidden = false;
        const extNote = H`<div class="ext-note">Extension mode: settings are stored in <code>chrome.storage.local</code>.</div>` as HTMLElement;
        root.append(extNote);
    }

    switchSettingsTab(resolveInitialTab(opts.initialTab));
    syncCustomModelVisibility();

    return root;
};


//onThemeChange: (theme) => this.options.onThemeChange?.(theme)
import { H } from "fest/lure";

//
import { showError, showSuccess } from "@rs-frontend/shared/Toast";
import { createCustomInstructionsPanel } from "@rs-frontend/shared/CustomInstructionsPanel";

//
import type { AppSettings, FieldConfig, SectionConfig, SectionKey, MCPConfig, GridShape } from "@rs-com/config/SettingsTypes";
import { BUILTIN_AI_MODELS, DEFAULT_SETTINGS } from "@rs-com/config/SettingsTypes";
import { applyGridSettings, type GridLayoutSettings } from "@rs-core/storage/StateStorage";

//
import { getByPath, loadSettings, saveSettings, slugify } from "@rs-com/config/Settings";
import { loadTimelineSources } from "@rs-core/storage/FileSystem";
import { writeFileSmart } from "@rs-core/storage/WriteFileSmart-v2";

//
import { AppSection } from "@rs-com/config/sections/AppSection";
import { CoreSection } from "@rs-com/config/sections/CoreSection";
import { RuntimeSection } from "@rs-com/config/sections/RuntimeSection";
import { renderTabName } from "@rs-core/utils/Utils";
import { propRef, stringRef } from "fest/object";
import { orientRef } from "fest/lure";
import { actionRegistry } from "@rs-core/utils/Actions";
import { wallpaperState, persistWallpaper } from "@rs-core/storage/StateStorage";
import { applyTheme } from "@rs-core/utils/Theme";

//
export const SETTINGS_SECTIONS: SectionConfig[] = [RuntimeSection, CoreSection, AppSection];

//
const pickWallpaper = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
            const dir = "/images/wallpaper/";
            await writeFileSmart(null, dir, file);
            const path = `${dir}${file.name}`;
            wallpaperState.src = path;
            persistWallpaper();
            showSuccess("Wallpaper updated");
        } catch (e) {
            console.warn(e);
            showError("Failed to set wallpaper");
        }
    };
    input.click();
};

//
export const SECTION_KEYS = SETTINGS_SECTIONS.map((section) => section.key) as SectionKey[];

//
export const Settings = async () => {
    const container = H`<section id="settings" class="view-settings"></section>`;

    //
    const fieldRefs = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();
    const fieldMeta = new Map<string, FieldConfig>();
    const groupRefs = new Map<string, HTMLElement>();
    const navButtons = new Map<SectionKey, HTMLButtonElement>();
    const panelRefs = new Map<SectionKey, HTMLElement>();
    const forms = new Map<SectionKey, HTMLFormElement>();
    const tabbed = new Map<SectionKey, HTMLElement>();
    const statusText = stringRef("");

    // MCP management
    const mcpConfigs: MCPConfig[] = [];
    const mcpContainerRefs = new Map<string, HTMLElement>();

    //
    const createField = (config: FieldConfig) => {
        const id = `settings-${slugify(config.path)}-${fieldRefs.size}`;
        let control: HTMLInputElement | HTMLSelectElement | HTMLElement;
        let renderedControl: HTMLElement;

        if (config.type === "select" || config.type === "number-select") {
            const select = H`<select class="field-control" id=${id} name=${config.path}></select>` as HTMLSelectElement;
            (config.options ?? []).forEach((opt) => select.appendChild(new Option(opt.label, opt.value)));
            control = select;
            renderedControl = select;
        } else if (config.type === "textarea") {
            const textarea = H`<textarea class="field-control" id=${id} name=${config.path} rows="4" spellcheck="false"></textarea>` as HTMLTextAreaElement;
            textarea.placeholder = config.placeholder ?? "";
            control = textarea;
            renderedControl = textarea;
        } else if (config.type === "color-palette") {
            const hidden = H`<input type="hidden" id=${id} name=${config.path} />` as HTMLInputElement;
            const palette = H`<div class="color-palette-grid" style="display: flex; gap: 8px; flex-wrap: wrap;"></div>` as HTMLElement;

            (config.options ?? []).forEach((opt) => {
                const btn = H`<button type="button" class="color-option" data-color=${opt.color} title=${opt.label} data-value=${opt.value}></button>` as HTMLButtonElement;

                btn.onclick = () => {
                    hidden.value = opt.value;
                    // Update visual selection
                    const allBtns = palette.querySelectorAll(".color-option");
                    allBtns.forEach((b) => ((b as HTMLElement).style.borderColor = "transparent"));
                    btn.style.borderColor = "var(--text-primary, #fff)"; // highlight selected

                    // Live preview
                    if (config.path === "appearance.color") {
                        document.documentElement.style.setProperty("--current", opt.value);
                        document.documentElement.style.setProperty("--primary", opt.value);
                        document.body.style.setProperty("--current", opt.value);
                        document.body.style.setProperty("--primary", opt.value);
                    }
                };
                palette.append(btn);
            });

            const wrapper = H`<div>${palette}${hidden}</div>` as HTMLElement;
            control = hidden;
            renderedControl = wrapper;
        } else if (config.type === "shape-palette") {
            const hidden = H`<input type="hidden" id=${id} name=${config.path} />` as HTMLInputElement;
            const palette = H`<div class="shape-palette-grid"></div>` as HTMLElement;

            (config.options ?? []).forEach((opt) => {
                const btn = H`<button type="button" class="shape-option" title=${opt.label} data-value=${opt.value}>
                    <span class="shape-preview shaped" data-shape=${opt.shape || opt.value}></span>
                    <span class="shape-label">${opt.label}</span>
                </button>` as HTMLButtonElement;

                btn.onclick = () => {
                    hidden.value = opt.value;
                    // Update visual selection
                    const allBtns = palette.querySelectorAll(".shape-option");
                    allBtns.forEach((b) => b.classList.remove("is-selected"));
                    btn.classList.add("is-selected");

                    // Live preview for grid shape
                    if (config.path === "grid.shape") {
                        document.querySelectorAll(".speed-dial-grid").forEach((grid) => {
                            (grid as HTMLElement).dataset.gridShape = opt.value;
                        });
                    }
                };
                palette.append(btn);
            });

            const wrapper = H`<div>${palette}${hidden}</div>` as HTMLElement;
            control = hidden;
            renderedControl = wrapper;
        } else {
            const input = H`<input class="field-control" id=${id} name=${config.path} type=${config.type === "password" ? "password" : "text"} placeholder=${config.placeholder ?? ""} />` as HTMLInputElement;
            input.autocomplete = "off";
            control = input;
            renderedControl = input;
        }

        control.dataset.path = config.path;
        const field = H`<div class="field">
            <label class="field-label">${config.label}</label>
            ${renderedControl}
            ${config.helper ? H`<span class="field-hint">${config.helper}</span>` : null}
        </div>` as HTMLElement;

        fieldRefs.set(config.path, control as any);
        fieldMeta.set(config.path, config);
        return field;
    };

    //
    const createGroup = (sectionKey: SectionKey, config: SectionConfig["groups"][number]) => {
        if (config.collapsible) {
            const details = H`<details class="settings-group is-collapsible" ${config.startOpen ? "open" : ""}></details>` as HTMLDetailsElement;
            const summary = H`<summary>
                <span class="group-title">${config.label}</span>
                ${config.description ? H`<span class="group-note">${config.description}</span>` : null}
            </summary>` as HTMLElement;
            const body = H`<div class="group-body"></div>` as HTMLElement;
            details.append(summary, body);
            if (config.key) groupRefs.set(`${sectionKey}:${config.key}`, details);
            return { root: details, body };
        }
        const section = H`<section class="settings-group"></section>` as HTMLElement;
        const header = H`<header class="group-header">
            <h3>${config.label}</h3>
            ${config.description ? H`<p>${config.description}</p>` : null}
        </header>` as HTMLElement;
        const body = H`<div class="group-body"></div>` as HTMLElement;
        section.append(header, body);
        if (config.key) groupRefs.set(`${sectionKey}:${config.key}`, section);
        return { root: section, body };
    };

    // MCP management functions
    const createMCPField = (mcpId: string, fieldName: string, label: string, type: "text" | "password" = "text", placeholder: string = "") => {
        const fieldId = `mcp-${mcpId}-${fieldName}`;
        const control = H`<input class="field-control" id=${fieldId} name=${`mcp.${mcpId}.${fieldName}`} type=${type} placeholder=${placeholder} />` as HTMLInputElement;
        control.dataset.mcpId = mcpId;
        control.dataset.fieldName = fieldName;
        const field = H`<div class="field">
            <label class="field-label">${label}</label>
            ${control}
            </div>` as HTMLElement;
        fieldRefs.set(`mcp.${mcpId}.${fieldName}`, control);
        return field;
    };

    const createMCPContainer = (mcpConfig: MCPConfig, isNew: boolean = false) => {
        const container = H`<div class="mcp-config ${isNew ? "mcp-config-new" : ""}" data-mcp-id=${mcpConfig.id}>
            <div class="mcp-header">
                <h4>MCP Server: ${mcpConfig.serverLabel || "New Server"}</h4>
                <button type="button" class="btn btn-danger btn-sm remove-mcp" data-mcp-id=${mcpConfig.id} on:click=${() => removeMCPConfig(mcpConfig.id)}>
                    <ui-icon icon="trash"></ui-icon>
                    <span>Remove</span>
                </button>
            </div>
            <div class="mcp-fields">
                ${createMCPField(mcpConfig.id, "serverLabel", "Server Label", "text", "my-bridge")}
                ${createMCPField(mcpConfig.id, "origin", "Origin", "text", "https://server.example")}
                ${createMCPField(mcpConfig.id, "clientKey", "Client Key", "text")}
                ${createMCPField(mcpConfig.id, "secretKey", "Secret Key", "password")}
            </div>
        </div>` as HTMLElement;

        mcpContainerRefs.set(mcpConfig.id, container);
        return container;
    };

    const addMCPConfig = () => {
        const newId = `mcp-${Date.now()}`;
        const newConfig: MCPConfig = {
            id: newId,
            serverLabel: "",
            origin: "",
            clientKey: "",
            secretKey: ""
        };
        mcpConfigs.push(newConfig);

        const mcpGroup = groupRefs.get("core:mcp-management");
        if (mcpGroup) {
            const body = mcpGroup.querySelector(".group-body") as HTMLElement;
            if (body) {
                // Insert before the add button (which should be the last element)
                const addButton = body.querySelector(".mcp-actions");
                const container = createMCPContainer(newConfig, true);
                if (addButton) {
                    addButton.before(container);
                } else {
                    body.append(container);
                }
            }
        }
    };

    const removeMCPConfig = (mcpId: string) => {
        const index = mcpConfigs.findIndex((config) => config.id === mcpId);
        if (index !== -1) {
            mcpConfigs.splice(index, 1);
        }

        const container = mcpContainerRefs.get(mcpId);
        if (container) {
            container.remove();
            mcpContainerRefs.delete(mcpId);
        }

        // Remove field references
        fieldRefs.forEach((_control, path) => {
            if (path.startsWith(`mcp.${mcpId}.`)) {
                fieldRefs.delete(path);
            }
        });
    };

    const renderMCPs = (settings: AppSettings) => {
        // Clear internal array
        mcpConfigs.length = 0;
        if (settings.ai?.mcp && Array.isArray(settings.ai.mcp)) {
            mcpConfigs.push(...settings.ai.mcp);
        }

        const mcpGroup = groupRefs.get("core:mcp-management");
        if (mcpGroup) {
            const body = mcpGroup.querySelector(".group-body") as HTMLElement;
            if (body) {
                // Clear existing MCP containers
                const existingContainers = body.querySelectorAll(".mcp-config");
                existingContainers.forEach((container) => container.remove());

                // Add loaded MCP configurations
                const addButton = body.querySelector(".mcp-actions");
                mcpConfigs.forEach((config) => {
                    if (addButton) {
                        addButton.before(createMCPContainer(config));
                    } else {
                        body.append(createMCPContainer(config));
                    }
                });
            }
        }
    };

    //
    SETTINGS_SECTIONS.forEach((section) => {
        const button = H`<button type="button" class="settings-tab" role="tab" id=${`tab-${section.key}`} aria-controls=${`panel-${section.key}`} aria-selected="false" on:click=${() => activateSection(section.key)}>
            <ui-icon icon=${section.icon}></ui-icon>
            <span>${section.title}</span>
        </button>` as HTMLButtonElement;
        button.tabIndex = -1;
        navButtons.set(section.key, button);

        const panel = H`<section class="settings-panel" role="tabpanel" id=${`panel-${section.key}`} aria-labelledby=${`tab-${section.key}`}></section>` as HTMLElement;
        panel.setAttribute("tabindex", "-1");
        panelRefs.set(section.key, panel);

        const panelForm = H`<form class="settings-form" data-section=${section.key}></form>` as HTMLFormElement;
        panelForm.noValidate = true;
        panel.append(panelForm);
        forms.set(section.key, panelForm);

        const panelHeader = H`<header class="panel-header">
            <h2>${section.title}</h2>
            <p>${section.description}</p>
        </header>` as HTMLElement;
        panelForm.append(panelHeader);

        section.groups.forEach((group) => {
            const { root, body } = createGroup(section.key, group);

            // Special handling for Custom Instructions section
            if (group.key === "custom-instructions") {
                body.append(createCustomInstructionsPanel());
            }
            // Special handling for MCP section
            else if (group.key === "mcp-management") {
                // Add MCP management buttons
                const addButton = H`<button type="button" class="btn btn-primary add-mcp" on:click=${addMCPConfig}>
                    <ui-icon icon="plus"></ui-icon>
                    <span>Add MCP Server</span>
                </button>` as HTMLButtonElement;

                //
                mcpConfigs.forEach((config) => {
                    body.append(createMCPContainer(config));
                });

                //
                body.append(H`<div class="mcp-actions">${addButton}</div>` as HTMLElement);
            } else if (section.key === "app") {
                if (group.key === "actions") {
                    // Add Share clipboard button
                    const shareClipboardBtn = H`<button type="button" class="btn btn-secondary" on:click=${() =>
                        actionRegistry
                            .get("share-clipboard")?.(null as any, null as any, container)
                            ?.catch?.(console.warn.bind(console))}>
                        <ui-icon icon="share"></ui-icon>
                        <span>Share Clipboard</span>
                    </button>`;
                    body.append(shareClipboardBtn);
                } else if (group.key === "bluetooth") {
                    // Add Bluetooth Enable Acceptance button
                    const enableBluetoothBtn = H`<button type="button" class="btn btn-secondary" on:click=${() =>
                        actionRegistry
                            .get("bluetooth-enable-acceptance")?.(null as any, null as any, container)
                            ?.catch?.(console.warn.bind(console))}>
                        <ui-icon icon="bluetooth"></ui-icon>
                        <span>Enable Bluetooth Acceptance</span>
                    </button>`;
                    // Add Paste button
                    const pasteBtn = H`<button type="button" class="btn btn-secondary" on:click=${() =>
                        actionRegistry
                            .get("bluetooth-share-clipboard")?.(null as any, null as any, container)
                            ?.catch?.(console.warn.bind(console))}>
                        <ui-icon icon="clipboard"></ui-icon>
                        <span>Paste from Bluetooth</span>
                    </button>`;
                    const actionsContainer = H`<div class="settings-actions-group" style="display: flex; gap: 8px; flex-wrap: nowrap;">${pasteBtn}${enableBluetoothBtn}</div>`;
                    body.append(actionsContainer);
                } else if (group.key === "synchronization") {
                    // Add Import/Export buttons
                    const importBtn = H`<button type="button" class="btn btn-secondary" on:click=${() => actionRegistry.get("import-settings")?.(null as any, null as any, container)}>
                        <ui-icon icon="upload-simple"></ui-icon>
                        <span>Import Settings</span>
                    </button>`;
                    const exportBtn = H`<button type="button" class="btn btn-secondary" on:click=${() => actionRegistry.get("export-settings")?.(null as any, null as any, container)}>
                        <ui-icon icon="download-simple"></ui-icon>
                        <span>Export Settings</span>
                    </button>`;
                    const actionsContainer = H`<div class="settings-actions-group" style="display: flex; gap: 8px; flex-wrap: wrap;">${importBtn}${exportBtn}</div>`;
                    body.append(actionsContainer);
                } else if (group.key === "wallpaper") {
                    const wallpaperBtn = H`<button type="button" class="btn btn-primary" on:click=${pickWallpaper}>
                        <ui-icon icon="image"></ui-icon>
                        <span>Change Wallpaper</span>
                    </button>`;
                    body.append(wallpaperBtn);
                }

                // Still allow regular fields in addition to custom buttons if any
                group.fields.forEach((field) => body.append(createField(field)));
            } else {
                // Regular field handling
                group.fields.forEach((field) => body.append(createField(field)));
            }

            panelForm.append(root);
        });

        tabbed.set(section.key, panel);
        //panelsWrapper.append(panel);
    });

    //
    const panelsWrapper = H`<ui-tabbed-box
        orient=${orientRef()}
        toolbar-opened=${false}
        prop:tabs=${tabbed}
        prop:renderTabName=${renderTabName}
        currentTab=${SETTINGS_SECTIONS[0].key}
        style="background-color: transparent; inline-size: stretch; block-size: stretch;"
        class="all"
    ></ui-tabbed-box>` as HTMLElement;
    const tabsState: { value: SectionKey } = propRef(panelsWrapper, "currentTab", SETTINGS_SECTIONS[0].key);

    container.append(panelsWrapper);

    //
    const modelSelectEl = fieldRefs.get("ai.model") as HTMLSelectElement | undefined;
    const customModelInput = fieldRefs.get("ai.customModel") as HTMLInputElement | undefined;
    const shareTargetModeSelectEl = fieldRefs.get("ai.shareTargetMode") as HTMLSelectElement | undefined;
    const customModelGroup = groupRefs.get("core:custom-model");
    const timelineInputEl = fieldRefs.get("timeline.source") as HTMLInputElement | undefined;

    //
    const timelineRecentSelect = H`<select class="field-control" style="margin-block-start: 0.5rem; inline-size: 100%;">
        <option value="">Select recent file...</option>
    </select>` as HTMLSelectElement;

    if (timelineInputEl) {
        timelineInputEl.parentElement?.append(timelineRecentSelect);
        timelineRecentSelect.addEventListener("change", () => {
            if (timelineRecentSelect.value) {
                timelineInputEl.value = timelineRecentSelect.value;
                timelineInputEl.dispatchEvent(new Event("input", { bubbles: true }));
            }
            timelineRecentSelect.value = "";
        });
    }

    const syncCustomVisibility = () => {
        if (!modelSelectEl || !customModelGroup || !customModelInput) return;
        const isCustom = modelSelectEl.value === "custom";
        customModelGroup.hidden = !isCustom;
        if (isCustom) {
            customModelInput.removeAttribute("disabled");
        } else {
            customModelInput.setAttribute("disabled", "true");
        }
    };

    modelSelectEl?.addEventListener("change", syncCustomVisibility);
    customModelInput?.addEventListener("focus", () => {
        if (modelSelectEl && modelSelectEl.value !== "custom") {
            modelSelectEl.value = "custom";
            syncCustomVisibility();
        }
    });
    customModelInput?.addEventListener("input", () => {
        if (modelSelectEl && modelSelectEl.value !== "custom") {
            modelSelectEl.value = "custom";
            syncCustomVisibility();
        }
    });

    const setControlValue = (control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: unknown) => {
        const stringValue = value == null ? "" : String(value);
        if (control instanceof HTMLSelectElement) {
            const option = Array.from(control.options).find((opt) => opt.value === stringValue);
            if (option) {
                control.value = stringValue;
            } else if (stringValue) {
                control.appendChild(new Option(stringValue, stringValue, true, true));
            } else {
                control.selectedIndex = 0; // Default to first if not found
            }
        } else {
            control.value = stringValue;
            // Update visual state for color palette
            if (control.type === "hidden" && control.parentElement?.querySelector(".color-palette-grid")) {
                const palette = control.parentElement.querySelector(".color-palette-grid");
                if (palette) {
                    palette.querySelectorAll(".color-option").forEach((b) => {
                        if ((b as HTMLElement).dataset.value === stringValue) {
                            (b as HTMLElement).style.borderColor = "var(--text-primary, #fff)";
                        } else {
                            (b as HTMLElement).style.borderColor = "transparent";
                        }
                    });
                }
            }
            // Update visual state for shape palette
            if (control.type === "hidden" && control.parentElement?.querySelector(".shape-palette-grid")) {
                const palette = control.parentElement.querySelector(".shape-palette-grid");
                if (palette) {
                    palette.querySelectorAll(".shape-option").forEach((b) => {
                        if ((b as HTMLElement).dataset.value === stringValue) {
                            b.classList.add("is-selected");
                        } else {
                            b.classList.remove("is-selected");
                        }
                    });
                }
            }
        }
    };

    const applySettingsToForm = (settings: AppSettings) => {
        fieldRefs.forEach((control, path) => {
            if (path === "ai.shareTargetMode" || path === "ai.model" || path === "ai.customModel" || path === "timeline.source" || path.startsWith("mcp.")) return;
            const value = getByPath(settings, path);
            if (Array.isArray(value) || typeof value === "object") {
                setControlValue(control, JSON.stringify(value ?? "", null, 2));
            } else {
                setControlValue(control, value ?? "");
            }
        });

        // Apply share target mode
        if (shareTargetModeSelectEl) {
            setControlValue(shareTargetModeSelectEl, settings.ai?.shareTargetMode || DEFAULT_SETTINGS.ai?.shareTargetMode || "recognize");
        }

        // Apply MCP configurations
        if (settings.ai?.mcp && Array.isArray(settings.ai.mcp)) {
            settings.ai.mcp.forEach((mcpConfig) => {
                const serverLabelControl = fieldRefs.get(`mcp.${mcpConfig.id}.serverLabel`);
                const originControl = fieldRefs.get(`mcp.${mcpConfig.id}.origin`);
                const clientKeyControl = fieldRefs.get(`mcp.${mcpConfig.id}.clientKey`);
                const secretKeyControl = fieldRefs.get(`mcp.${mcpConfig.id}.secretKey`);

                if (serverLabelControl) setControlValue(serverLabelControl, mcpConfig.serverLabel);
                if (originControl) setControlValue(originControl, mcpConfig.origin);
                if (clientKeyControl) setControlValue(clientKeyControl, mcpConfig.clientKey);
                if (secretKeyControl) setControlValue(secretKeyControl, mcpConfig.secretKey);
            });
        }
    };

    const applyModelSelection = (settings: AppSettings) => {
        if (!modelSelectEl) return;
        const storedModel = settings.ai?.model ?? DEFAULT_SETTINGS.ai?.model ?? "gpt-5.4";
        const storedCustom = settings.ai?.customModel ?? DEFAULT_SETTINGS.ai?.customModel ?? "gpt-5.4";
        if (BUILTIN_AI_MODELS.includes(storedModel as (typeof BUILTIN_AI_MODELS)[number])) {
            modelSelectEl.value = storedModel;
            if (customModelInput) customModelInput.value = storedCustom ?? "";
        } else if (storedModel === "custom") {
            modelSelectEl.value = "custom";
            if (customModelInput) customModelInput.value = storedCustom ?? "";
        } else {
            modelSelectEl.value = "custom";
            if (customModelInput) customModelInput.value = storedCustom || storedModel;
        }
        syncCustomVisibility();
    };

    const readValue = (path: string) => {
        const control = fieldRefs.get(path);
        if (!control) return "";
        const rawValue = (control as HTMLInputElement | HTMLSelectElement).value;
        const meta = fieldMeta.get(path);
        return typeof rawValue === "string" ? (meta?.type === "password" ? rawValue : rawValue.trim()) : "";
    };

    const updateTimelineSelect = async (settings: AppSettings) => {
        if (timelineInputEl) {
            const saved = settings.timeline?.source?.trim?.() ?? "";
            timelineInputEl.value = saved;
        }
        if (timelineRecentSelect) {
            timelineRecentSelect.replaceChildren(new Option("Select recent file...", ""));
            const options = await loadTimelineSources();
            options.forEach((name) => timelineRecentSelect.appendChild(new Option(name, name)));
        }
    };

    function activateSection(key: SectionKey) {
        tabsState.value = key;
        navButtons.forEach((button, sectionKey) => {
            const selected = sectionKey === key;
            button.setAttribute("aria-selected", selected ? "true" : "false");
            button.classList.toggle("is-active", selected);
            button.tabIndex = selected ? 0 : -1;
        });
        panelRefs.forEach((panel, sectionKey) => {
            const selected = sectionKey === key;
            //panel.hidden = !selected;
            //panel.setAttribute("aria-hidden", selected ? "false" : "true");
            panel.tabIndex = selected ? 0 : -1;
        });
        tabsState.value = key;
    }

    //
    activateSection(tabsState.value);

    //
    let settings = await loadSettings();

    // Populate Speech languages
    const speechLangField = fieldMeta.get("speech.language");
    if (speechLangField && typeof navigator !== "undefined" && navigator.languages) {
        // Use a Set to avoid duplicates if any, though navigator.languages shouldn't have them
        const uniqueLangs = Array.from(new Set(navigator.languages));
        speechLangField.options = uniqueLangs.map((lang) => ({ value: lang, label: lang }));
        // If navigator.language is not in the list (e.g. specialized), add it
        if (navigator.language && !uniqueLangs.includes(navigator.language)) {
            speechLangField.options.unshift({ value: navigator.language, label: navigator.language });
        }

        const select = fieldRefs.get("speech.language") as HTMLSelectElement;
        if (select) {
            select.innerHTML = "";
            // Add a default option if none
            if (speechLangField.options.length === 0) {
                select.appendChild(new Option("Default (en-US)", "en-US"));
            } else {
                speechLangField.options.forEach((opt) => select.appendChild(new Option(opt.label, opt.value)));
            }
        }
    }

    // Load existing MCP configurations BEFORE applying settings
    renderMCPs(settings);

    //
    await updateTimelineSelect(settings);
    applySettingsToForm(settings);
    applyModelSelection(settings);
    syncCustomVisibility();

    // Apply color settings
    if (settings.appearance?.color) {
        document.documentElement.style.setProperty("--current", settings.appearance.color);
        document.documentElement.style.setProperty("--primary", settings.appearance.color);
        document.body.style.setProperty("--current", settings.appearance.color);
        document.body.style.setProperty("--primary", settings.appearance.color);
    }

    //
    const handleFormInput = (event: Event) => {
        if (!(event.target instanceof HTMLElement)) return;
        if (!event.target.closest(".settings-form")) return;
        statusText.value = "";
    };

    //
    const parseJSONSafe = <T = any>(value: string, fallback: T): T => {
        if (!value) return fallback;
        try {
            return JSON.parse(value) as T;
        } catch {
            return fallback;
        }
    };

    const handleSubmit = async (event: SubmitEvent) => {
        const submittedForm = event.target;
        if (!(submittedForm instanceof HTMLFormElement) || !submittedForm.classList.contains("settings-form")) return;
        event.preventDefault();

        const modelSelection = modelSelectEl?.value ?? DEFAULT_SETTINGS.ai?.model;
        const customIdentifier = customModelInput?.value.trim() ?? "";
        const isCustomSelected = modelSelection === "custom";

        if (isCustomSelected && !customIdentifier) {
            showError("Enter a custom model identifier before saving.");
            customModelInput?.focus();
            return;
        }

        // Collect MCP configurations
        const mcpConfigurations: MCPConfig[] = [];
        mcpConfigs.forEach((config) => {
            const serverLabel = readValue(`mcp.${config.id}.serverLabel`);
            const origin = readValue(`mcp.${config.id}.origin`);
            const clientKey = readValue(`mcp.${config.id}.clientKey`);
            const secretKey = readValue(`mcp.${config.id}.secretKey`);

            // Only include MCP configs that have at least a server label
            if (serverLabel.trim()) {
                mcpConfigurations.push({
                    id: config.id,
                    serverLabel: serverLabel,
                    origin: origin,
                    clientKey: clientKey,
                    secretKey: secretKey
                });
            }
        });

        //
        const encryptRaw = readValue("core.encrypt");
        const preferBackendSyncRaw = readValue("core.preferBackendSync");

        const httpTargets = parseJSONSafe(readValue("core.ops.httpTargets"), []);
        const wsTargets = parseJSONSafe(readValue("core.ops.wsTargets"), []);
        const syncTargets = parseJSONSafe(readValue("core.ops.syncTargets"), []);
        const allowUnencryptedRaw = readValue("core.ops.allowUnencrypted");

        const next: AppSettings = {
            core: {
                mode: (readValue("core.mode") as any) || DEFAULT_SETTINGS.core?.mode || "native",
                endpointUrl: readValue("core.endpointUrl"),
                userId: readValue("core.userId"),
                userKey: readValue("core.userKey"),
                encrypt: encryptRaw === "true" || encryptRaw === "1" || encryptRaw === "yes",
                preferBackendSync: preferBackendSyncRaw === "true" || preferBackendSyncRaw === "1" || preferBackendSyncRaw === "yes",
                ops: {
                    allowUnencrypted: allowUnencryptedRaw === "true" || allowUnencryptedRaw === "1" || allowUnencryptedRaw === "yes",
                    httpTargets: Array.isArray(httpTargets) ? httpTargets : [],
                    wsTargets: Array.isArray(wsTargets) ? wsTargets : [],
                    syncTargets: Array.isArray(syncTargets) ? syncTargets : []
                }
            },
            ai: {
                apiKey: readValue("ai.apiKey"),
                baseUrl: readValue("ai.baseUrl"),
                shareTargetMode: (readValue("ai.shareTargetMode") as "analyze" | "recognize") || DEFAULT_SETTINGS.ai?.shareTargetMode || "recognize",
                model: isCustomSelected ? "custom" : modelSelection,
                customModel: isCustomSelected ? customIdentifier : "",
                mcp: mcpConfigurations
            },
            webdav: {
                url: readValue("webdav.url") || DEFAULT_SETTINGS.webdav?.url,
                username: readValue("webdav.username"),
                password: readValue("webdav.password"),
                token: readValue("webdav.token")
            },
            timeline: {
                source: readValue("timeline.source")
            },
            appearance: {
                theme: (readValue("appearance.theme") as any) || "auto",
                color: readValue("appearance.color")
            },
            speech: {
                language: readValue("speech.language") as any
            },
            grid: {
                columns: parseInt(readValue("grid.columns"), 10) || DEFAULT_SETTINGS.grid?.columns || 4,
                rows: parseInt(readValue("grid.rows"), 10) || DEFAULT_SETTINGS.grid?.rows || 8,
                shape: (readValue("grid.shape") as GridShape) || DEFAULT_SETTINGS.grid?.shape || "square"
            }
        };

        //
        try {
            settings = await saveSettings(next);
            await updateTimelineSelect(settings);
            applyModelSelection(settings);
            applyTheme(settings);
            applyGridSettings({ grid: settings.grid as unknown as GridLayoutSettings });

            //
            statusText.value = "Saved";
            showSuccess("Settings updated");
            syncCustomVisibility();
            setTimeout(() => {
                statusText.value = "";
            }, 1600);
        } catch (e) {
            console.warn(e);
            showError("Failed to save settings");
            statusText.value = "Error";
            setTimeout(() => {
                statusText.value = "";
            }, 1800);
        }
    };

    //
    container.addEventListener("input", handleFormInput);
    container.addEventListener("submit", handleSubmit);
    container.tabsState = tabsState;
    container.forms = forms;
    (container as any).reloadSettings = async (newSettings?: AppSettings) => {
        settings = newSettings || (await loadSettings());
        renderMCPs(settings);
        await updateTimelineSelect(settings);
        applySettingsToForm(settings);
        applyModelSelection(settings);
        syncCustomVisibility();
        applyTheme(settings);
        showSuccess("Settings reloaded");
    };
    return container as HTMLElement;
};
