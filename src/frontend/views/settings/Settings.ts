//@ts-ignore
import style from "./Settings.scss?inline";

import { H } from "fest/lure";
import { loadSettings, saveSettings } from "@rs-com/config/Settings";
import { BUILTIN_AI_MODELS, type AppSettings, type MCPConfig } from "@rs-com/config/SettingsTypes";
import { applyTheme } from "@rs-core/utils/Theme";
import { setString, StorageKeys } from "../../../core/storage";
import { navigateToView } from "../../main/routing";
import { createCustomInstructionsEditor } from "../../items/CustomInstructionsEditor";
import { loadAsAdopted } from "fest/dom";
import { wallpaperState, persistWallpaper } from "@rs-core/storage/StateStorage";

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
        <button class="settings-tab-btn" type="button" data-action="switch-settings-tab" data-tab="launcher" aria-selected="false">Launcher</button>
        <button class="settings-tab-btn" type="button" data-action="switch-settings-tab" data-tab="environment" aria-selected="false">Environment</button>
        <button class="settings-tab-btn" type="button" data-action="switch-settings-tab" data-tab="layout" aria-selected="false">Layout</button>
        <button class="settings-tab-btn" type="button" data-action="switch-settings-tab" data-tab="markdown" aria-selected="false">Markdown</button>
        <button class="settings-tab-btn is-active" type="button" data-action="switch-settings-tab" data-tab="ai" aria-selected="true">AI</button>
        <button class="settings-tab-btn" type="button" data-action="switch-settings-tab" data-tab="mcp" aria-selected="false">MCP</button>
        <button class="settings-tab-btn" type="button" data-action="switch-settings-tab" data-tab="instructions" aria-selected="false">Instructions</button>
        <button class="settings-tab-btn" type="button" data-action="switch-settings-tab" data-tab="extension" aria-selected="false" data-extension-tab hidden>Extension</button>
        <h2>Settings</h2>
        </div>
    </section>

    <section class="card settings-tab-panel" data-tab-panel="launcher">
      <h3>Launcher</h3>
      <label class="field checkbox form-checkbox">
        <input type="checkbox" data-field="appearance.launcher.showDock" />
        <span>Show dock</span>
      </label>
      <label class="field checkbox form-checkbox">
        <input type="checkbox" data-field="appearance.launcher.showTaskbarOverlay" />
        <span>Show taskbar overlay (desktop)</span>
      </label>
      <label class="field">
        <span>Dock position</span>
        <select class="form-select" data-field="appearance.launcher.dockPosition">
          <option value="bottom">Bottom</option>
          <option value="left">Left</option>
          <option value="right">Right</option>
        </select>
      </label>
      <label class="field">
        <span>Launcher icon size</span>
        <select class="form-select" data-field="appearance.launcher.iconSize">
          <option value="small">Small</option>
          <option value="medium">Medium</option>
          <option value="large">Large</option>
        </select>
      </label>
      <label class="field">
        <span>URL paste behavior (home screen)</span>
        <select class="form-select" data-field="appearance.launcher.urlPasteMode">
          <option value="shortcut">Create shortcut</option>
          <option value="open-now">Open directly</option>
        </select>
      </label>
      <label class="field">
        <span>URL open target</span>
        <select class="form-select" data-field="appearance.launcher.urlOpenTarget">
          <option value="_blank">New window/tab</option>
          <option value="_self">Same tab</option>
        </select>
      </label>
    </section>

    <section class="card settings-tab-panel" data-tab-panel="environment">
      <h3>Environment</h3>
      <label class="field">
        <span>Wallpaper opacity (0-1)</span>
        <input class="form-input" type="number" inputmode="decimal" min="0" max="1" step="0.05" data-field="appearance.environment.wallpaperOpacity" />
      </label>
      <label class="field">
        <span>Wallpaper blur (px)</span>
        <input class="form-input" type="number" inputmode="decimal" min="0" max="24" step="0.5" data-field="appearance.environment.wallpaperBlur" />
      </label>
      <label class="field">
        <span>Wallpaper rotate (deg)</span>
        <input class="form-input" type="number" inputmode="numeric" min="-360" max="360" step="1" data-field="appearance.environment.wallpaperRotate" />
      </label>
      <label class="field checkbox form-checkbox">
        <input type="checkbox" data-field="appearance.environment.statusbarWidgets" />
        <span>Enable status bar widgets</span>
      </label>
      <label class="field checkbox form-checkbox">
        <input type="checkbox" data-field="appearance.environment.mobileFullscreenStatusbar" />
        <span>Mobile fullscreen status bar</span>
      </label>
    </section>

    <section class="card settings-tab-panel" data-tab-panel="layout">
      <h3>Layout</h3>
      <label class="field">
        <span>Desktop window mode</span>
        <select class="form-select" data-field="appearance.layout.desktopWindowMode">
          <option value="windowed">Windowed</option>
          <option value="maximized">Maximized</option>
        </select>
      </label>
      <label class="field">
        <span>Mobile window mode</span>
        <select class="form-select" data-field="appearance.layout.mobileWindowMode">
          <option value="maximized">Maximized</option>
          <option value="windowed">Windowed</option>
        </select>
      </label>
      <label class="field checkbox form-checkbox">
        <input type="checkbox" data-field="appearance.layout.mobileScrollableTabs" />
        <span>Scrollable tabs on mobile</span>
      </label>
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
      <label class="field checkbox form-checkbox">
        <input type="checkbox" data-field="appearance.markdown.modules.typography" />
        <span>Typography module</span>
      </label>
      <label class="field checkbox form-checkbox">
        <input type="checkbox" data-field="appearance.markdown.modules.tables" />
        <span>Tables module</span>
      </label>
      <label class="field checkbox form-checkbox">
        <input type="checkbox" data-field="appearance.markdown.modules.codeBlocks" />
        <span>Code blocks module</span>
      </label>
      <label class="field checkbox form-checkbox">
        <input type="checkbox" data-field="appearance.markdown.modules.blockquotes" />
        <span>Blockquotes module</span>
      </label>
      <label class="field checkbox form-checkbox">
        <input type="checkbox" data-field="appearance.markdown.modules.media" />
        <span>Media module</span>
      </label>
      <label class="field checkbox form-checkbox">
        <input type="checkbox" data-field="appearance.markdown.modules.printBreaks" />
        <span>Print breaks module</span>
      </label>
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
    const launcherShowDock = field('[data-field="appearance.launcher.showDock"]') as HTMLInputElement | null;
    const launcherShowTaskbarOverlay = field('[data-field="appearance.launcher.showTaskbarOverlay"]') as HTMLInputElement | null;
    const launcherDockPosition = field('[data-field="appearance.launcher.dockPosition"]') as HTMLSelectElement | null;
    const launcherIconSize = field('[data-field="appearance.launcher.iconSize"]') as HTMLSelectElement | null;
    const launcherUrlPasteMode = field('[data-field="appearance.launcher.urlPasteMode"]') as HTMLSelectElement | null;
    const launcherUrlOpenTarget = field('[data-field="appearance.launcher.urlOpenTarget"]') as HTMLSelectElement | null;
    const environmentWallpaperOpacity = field('[data-field="appearance.environment.wallpaperOpacity"]') as HTMLInputElement | null;
    const environmentWallpaperBlur = field('[data-field="appearance.environment.wallpaperBlur"]') as HTMLInputElement | null;
    const environmentWallpaperRotate = field('[data-field="appearance.environment.wallpaperRotate"]') as HTMLInputElement | null;
    const environmentStatusbarWidgets = field('[data-field="appearance.environment.statusbarWidgets"]') as HTMLInputElement | null;
    const environmentMobileFullscreenStatusbar = field('[data-field="appearance.environment.mobileFullscreenStatusbar"]') as HTMLInputElement | null;
    const layoutDesktopWindowMode = field('[data-field="appearance.layout.desktopWindowMode"]') as HTMLSelectElement | null;
    const layoutMobileWindowMode = field('[data-field="appearance.layout.mobileWindowMode"]') as HTMLSelectElement | null;
    const layoutMobileScrollableTabs = field('[data-field="appearance.layout.mobileScrollableTabs"]') as HTMLInputElement | null;
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
        const availableTabs = new Set(["appearance", "launcher", "environment", "layout", "markdown", "ai", "mcp", "instructions", "extension"]);
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
            if (launcherShowDock) launcherShowDock.checked = (s?.appearance?.launcher?.showDock ?? true) !== false;
            if (launcherShowTaskbarOverlay) launcherShowTaskbarOverlay.checked = (s?.appearance?.launcher?.showTaskbarOverlay ?? true) !== false;
            if (launcherDockPosition) launcherDockPosition.value = (s?.appearance?.launcher?.dockPosition || "bottom") as any;
            if (launcherIconSize) launcherIconSize.value = (s?.appearance?.launcher?.iconSize || "medium") as any;
            if (launcherUrlPasteMode) launcherUrlPasteMode.value = (s?.appearance?.launcher?.urlPasteMode || "shortcut") as any;
            if (launcherUrlOpenTarget) launcherUrlOpenTarget.value = (s?.appearance?.launcher?.urlOpenTarget || "_blank") as any;
            try {
                localStorage.setItem("cw::env::url-paste-mode", String(s?.appearance?.launcher?.urlPasteMode || "shortcut"));
                localStorage.setItem("cw::env::url-paste-target", String(s?.appearance?.launcher?.urlOpenTarget || "_blank"));
            } catch {
                // no-op
            }
            if (environmentWallpaperOpacity) environmentWallpaperOpacity.value = String(s?.appearance?.environment?.wallpaperOpacity ?? wallpaperState.opacity ?? 1);
            if (environmentWallpaperBlur) environmentWallpaperBlur.value = String(s?.appearance?.environment?.wallpaperBlur ?? wallpaperState.blur ?? 0);
            if (environmentWallpaperRotate) environmentWallpaperRotate.value = String(s?.appearance?.environment?.wallpaperRotate ?? wallpaperState.rotate ?? 0);
            if (environmentStatusbarWidgets) environmentStatusbarWidgets.checked = (s?.appearance?.environment?.statusbarWidgets ?? true) !== false;
            if (environmentMobileFullscreenStatusbar) environmentMobileFullscreenStatusbar.checked = (s?.appearance?.environment?.mobileFullscreenStatusbar ?? true) !== false;
            if (layoutDesktopWindowMode) layoutDesktopWindowMode.value = (s?.appearance?.layout?.desktopWindowMode || "windowed") as any;
            if (layoutMobileWindowMode) layoutMobileWindowMode.value = (s?.appearance?.layout?.mobileWindowMode || "maximized") as any;
            if (layoutMobileScrollableTabs) layoutMobileScrollableTabs.checked = (s?.appearance?.layout?.mobileScrollableTabs ?? true) !== false;
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
                    launcher: {
                        showDock: (launcherShowDock?.checked ?? true) !== false,
                        showTaskbarOverlay: (launcherShowTaskbarOverlay?.checked ?? true) !== false,
                        dockPosition: (launcherDockPosition?.value as any) || "bottom",
                        iconSize: (launcherIconSize?.value as any) || "medium",
                        urlPasteMode: (launcherUrlPasteMode?.value as any) || "shortcut",
                        urlOpenTarget: (launcherUrlOpenTarget?.value as any) || "_blank",
                    },
                    environment: {
                        wallpaperOpacity: parseFloatInRange(environmentWallpaperOpacity?.value, 1, 0, 1),
                        wallpaperBlur: parseFloatInRange(environmentWallpaperBlur?.value, 0, 0, 24),
                        wallpaperRotate: parseNumberOrDefault(environmentWallpaperRotate?.value, 0),
                        statusbarWidgets: (environmentStatusbarWidgets?.checked ?? true) !== false,
                        mobileFullscreenStatusbar: (environmentMobileFullscreenStatusbar?.checked ?? true) !== false,
                    },
                    layout: {
                        desktopWindowMode: (layoutDesktopWindowMode?.value as any) || "windowed",
                        mobileWindowMode: (layoutMobileWindowMode?.value as any) || "maximized",
                        mobileScrollableTabs: (layoutMobileScrollableTabs?.checked ?? true) !== false,
                    },
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
            wallpaperState.opacity = Math.max(0, Math.min(1, Number(saved?.appearance?.environment?.wallpaperOpacity ?? 1)));
            wallpaperState.blur = Math.max(0, Number(saved?.appearance?.environment?.wallpaperBlur ?? 0));
            wallpaperState.rotate = Number(saved?.appearance?.environment?.wallpaperRotate ?? 0);
            persistWallpaper();
            try {
                const launcherCfg = saved?.appearance?.launcher;
                localStorage.setItem("cw::env::url-paste-mode", String(launcherCfg?.urlPasteMode || "shortcut"));
                localStorage.setItem("cw::env::url-paste-target", String(launcherCfg?.urlOpenTarget || "_blank"));
            } catch {
                // optional sync for home speed-dial behavior
            }
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