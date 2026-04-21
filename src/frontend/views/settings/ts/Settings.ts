//@ts-ignore
import style from "../scss/Settings.scss?inline";

import { H } from "fest/lure";
import { loadSettings, saveSettings } from "@rs-com/config/Settings";
import { BUILTIN_AI_MODELS, type AppSettings, type CoreMode, type MCPConfig } from "@rs-com/config/SettingsTypes";
import { openAdminDoorFromCore, resolveAdminDoorUrls } from "@rs-com/config/admin-doors";
import { sendMessage } from "@rs-com/core/UnifiedMessaging";
import { applyTheme } from "@rs-core/utils/Theme";
import { setString, StorageKeys } from "@rs-core/storage";
import { navigateToView } from "@shells/boot";
import { createCustomInstructionsEditor } from "../../../shared/ts/CustomInstructionsEditor";
import { loadAsAdopted } from "fest/dom";
import { applyAirpadRuntimeFromAppSettings } from "../../../views/airpad/config/config";

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
const readTrimmedControlValue = (
    control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null | undefined,
    fallback = ""
): string => {
    return control ? control.value.trim() : fallback;
};
const readCheckboxValue = (control: HTMLInputElement | null | undefined, fallback: boolean): boolean => {
    return control ? Boolean(control.checked) : fallback;
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

    <header class="settings-screen__top">
        <h2 class="settings-screen__title">Settings</h2>
        <div class="settings-tab-actions" data-settings-tabs data-active-tab="ai" role="tablist" aria-label="Settings categories">
        <button class="settings-tab-btn" type="button" role="tab" data-action="switch-settings-tab" data-tab="appearance" aria-selected="false">Appearance</button>
        <button class="settings-tab-btn" type="button" role="tab" data-action="switch-settings-tab" data-tab="markdown" aria-selected="false">Markdown</button>
        <button class="settings-tab-btn is-active" type="button" role="tab" data-action="switch-settings-tab" data-tab="ai" aria-selected="true">AI</button>
        <button class="settings-tab-btn" type="button" role="tab" data-action="switch-settings-tab" data-tab="mcp" aria-selected="false">MCP</button>
        <button class="settings-tab-btn" type="button" role="tab" data-action="switch-settings-tab" data-tab="server" aria-selected="false">Server</button>
        <button class="settings-tab-btn" type="button" role="tab" data-action="switch-settings-tab" data-tab="instructions" aria-selected="false">Instructions</button>
        <button class="settings-tab-btn" type="button" role="tab" data-action="switch-settings-tab" data-tab="extension" aria-selected="false" data-extension-tab hidden>Extension</button>
        </div>
    </header>

    <div class="settings-screen__body">
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

    <section class="card settings-tab-panel" data-tab-panel="server">
      <h3>Server</h3>
      <p class="field-hint" style="margin: 0 0 0.75rem; opacity: 0.88; font-size: 0.9em;">
        CWSP endpoint and this device’s identity. A default AirPad peer id or clipboard destination is not required to use the hub: connect with server URL and client id, then optionally set an access / control token and inbound allow lists (peer ids) for who may reach you directly or via relay. Per-destination <code>ID::AccessToken</code> in lists is supported on the wire. “Frontend as server” and WS reverse-listener roles are only partially implemented.
      </p>
      <h4>Endpoint and identity</h4>
      <label class="field">
        <span>Server URL</span>
        <input class="form-input" type="url" inputmode="url" autocomplete="off" placeholder="https://192.168.0.200:8443" data-field="core.endpointUrl" />
      </label>
      <label class="field">
        <span>Associated device / client ID</span>
        <input class="form-input" type="text" autocomplete="off" data-field="core.userId" placeholder="L-192.168.0.196" />
      </label>
      <label class="field">
        <span>Client identifier token</span>
        <input class="form-input" type="password" autocomplete="off" data-field="core.userKey" placeholder="Endpoint-issued key" />
      </label>
      <label class="field checkbox form-checkbox">
        <input type="checkbox" data-field="core.socket.allowAccessTokenWithoutUserKey" />
        <span>Allow access / control token without associated client identifier token</span>
      </label>
      <label class="field checkbox form-checkbox">
        <input type="checkbox" data-field="core.allowInsecureTls" />
        <span>Allow self-signed / insecure TLS</span>
      </label>

      <h4>AirPad</h4>
      <p class="field-hint" style="margin: 0 0 0.75rem; opacity: 0.82; font-size: 0.9em;">
        Defaults for remote control. Peer / route id is optional (leave empty for receive-only or hub-routed sessions). Optional tokens: control token authenticates coordinator acts; client access token is reserved for inbound / reverse-client WebSocket ACL (experimental).
      </p>
      <label class="field checkbox form-checkbox">
        <input type="checkbox" data-field="core.useCoreIdentityForAirPad" />
        <span>Use associated device ID as AirPad client id</span>
      </label>
      <label class="field">
        <span>AirPad peer / route ID (optional)</span>
        <input class="form-input" type="text" autocomplete="off" data-field="core.socket.routeTarget" placeholder="Empty OK — e.g. L-192.168.0.110 when routing to one peer" />
      </label>
      <label class="field">
        <span>AirPad control auth token (optional)</span>
        <input class="form-input" type="password" autocomplete="off" data-field="core.socket.accessToken" placeholder="Access / control (peer input routing)" />
      </label>
      <label class="field">
        <span>Client access token (optional, future)</span>
        <input class="form-input" type="password" autocomplete="off" data-field="core.socket.clientAccessToken" placeholder="Reverse-client / inbound WS ACL (experimental)" />
      </label>

      <h4>Clipboard (PWA)</h4>
      <p class="field-hint" style="margin: 0 0 0.75rem; opacity: 0.82; font-size: 0.9em;">
        Browser limits apply. Default destination ids are not required: use the inbound allow list and optional control token for policy; set explicit broadcast or share lists only when you want outbound fan-out. The Chrome extension reads the same saved settings for clipboard sync and coordinator acts (background / service worker).
      </p>
      <label class="field checkbox form-checkbox">
        <input type="checkbox" data-field="shell.maintainHubSocketConnection" />
        <span>Maintain background WebSocket to CWSP hub (needed for coordinator clipboard / acts)</span>
      </label>
      <label class="field checkbox form-checkbox">
        <input type="checkbox" data-field="shell.enableRemoteClipboardBridge" />
        <span>Enable clipboard bridge</span>
      </label>
      <label class="field">
        <span>Clipboard broadcast targets (optional)</span>
        <input class="form-input" type="text" autocomplete="off" data-field="shell.clipboardBroadcastTargets" placeholder="L-192.168.0.110; L-192.168.0.196::token — empty uses AirPad route / defaults" />
      </label>
      <label class="field checkbox form-checkbox">
        <input type="checkbox" data-field="shell.pushLocalClipboardToLan" />
        <span>Push local clipboard to peers (poll)</span>
      </label>
      <label class="field">
        <span>Clipboard push interval (ms)</span>
        <input class="form-input" type="number" inputmode="numeric" min="800" max="60000" step="100" data-field="shell.clipboardPushIntervalMs" placeholder="2000" />
      </label>
      <label class="field checkbox form-checkbox">
        <input type="checkbox" data-field="shell.acceptInboundClipboardData" />
        <span>Accept inbound clipboard data from peers</span>
      </label>
      <label class="field">
        <span>Inbound clipboard allow list (peer ids only; empty = any)</span>
        <input class="form-input" type="text" autocomplete="off" data-field="shell.clipboardInboundAllowIds" placeholder="L-192.168.0.110; L-192.168.0.196 — suffix ::token ignored for matching" />
      </label>
      <label class="field checkbox form-checkbox">
        <input type="checkbox" data-field="shell.accessTokenBypassesClipboardAllowlist" />
        <span>Access token bypasses inbound allow list (endpoint control token)</span>
      </label>
      <label class="field">
        <span>Share / quick-send clipboard destinations (optional)</span>
        <input class="form-input" type="text" autocomplete="off" data-field="shell.clipboardShareDestinationIds" placeholder="Overrides broadcast for share-target sends; ID::AccessToken allowed" />
      </label>
      <label class="field checkbox form-checkbox">
        <input type="checkbox" data-field="shell.applyRemoteClipboardToDevice" />
        <span>Apply incoming clipboard to this device</span>
      </label>
      <label class="field checkbox form-checkbox">
        <input type="checkbox" data-field="shell.acceptContactsBridgeData" />
        <span>Allow contacts bridge data (future / native)</span>
      </label>
      <label class="field checkbox form-checkbox">
        <input type="checkbox" data-field="shell.acceptSmsBridgeData" />
        <span>Allow SMS bridge data (future / native)</span>
      </label>
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
    </div>

    <footer class="settings-screen__footer">
        <button class="btn primary" type="button" data-action="save">Save</button>
        <span class="note" data-note></span>
    </footer>
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
    const coreMode = field('[data-field="core.mode"]') as HTMLSelectElement | null;
    const coreEndpointUrl = field('[data-field="core.endpointUrl"]') as HTMLInputElement | null;
    const coreUserId = field('[data-field="core.userId"]') as HTMLInputElement | null;
    const coreUserKey = field('[data-field="core.userKey"]') as HTMLInputElement | null;
    const corePreferBackendSync = field('[data-field="core.preferBackendSync"]') as HTMLInputElement | null;
    const coreEncrypt = field('[data-field="core.encrypt"]') as HTMLInputElement | null;
    const coreAppClientId = field('[data-field="core.appClientId"]') as HTMLInputElement | null;
    const coreAllowInsecureTls = field('[data-field="core.allowInsecureTls"]') as HTMLInputElement | null;
    const coreOpsAllowUnencrypted = field('[data-field="core.ops.allowUnencrypted"]') as HTMLInputElement | null;
    const coreAdminHttps = field('[data-field="core.admin.httpsOrigin"]') as HTMLInputElement | null;
    const coreAdminHttp = field('[data-field="core.admin.httpOrigin"]') as HTMLInputElement | null;
    const coreAdminPath = field('[data-field="core.admin.path"]') as HTMLInputElement | null;
    const coreUseCoreIdentityAirpad = field('[data-field="core.useCoreIdentityForAirPad"]') as HTMLInputElement | null;
    const coreSocketAccessToken = field('[data-field="core.socket.accessToken"]') as HTMLInputElement | null;
    const coreSocketRouteTarget = field('[data-field="core.socket.routeTarget"]') as HTMLInputElement | null;
    const coreSocketClientAccessToken = field('[data-field="core.socket.clientAccessToken"]') as HTMLInputElement | null;
    const coreSocketAllowAccessWithoutUserKey = field(
        '[data-field="core.socket.allowAccessTokenWithoutUserKey"]'
    ) as HTMLInputElement | null;
    const shellMaintainHubSocket = field('[data-field="shell.maintainHubSocketConnection"]') as HTMLInputElement | null;
    const shellClipboardBroadcastTargets = field('[data-field="shell.clipboardBroadcastTargets"]') as HTMLInputElement | null;
    const shellPushLocalClipboard = field('[data-field="shell.pushLocalClipboardToLan"]') as HTMLInputElement | null;
    const shellClipboardPushIntervalMs = field('[data-field="shell.clipboardPushIntervalMs"]') as HTMLInputElement | null;
    const shellClipboard = field('[data-field="shell.enableRemoteClipboardBridge"]') as HTMLInputElement | null;
    const shellAcceptInboundClipboard = field('[data-field="shell.acceptInboundClipboardData"]') as HTMLInputElement | null;
    const shellClipboardInboundAllowIds = field('[data-field="shell.clipboardInboundAllowIds"]') as HTMLInputElement | null;
    const shellAccessTokenBypassClipboardAllow = field(
        '[data-field="shell.accessTokenBypassesClipboardAllowlist"]'
    ) as HTMLInputElement | null;
    const shellClipboardShareDestIds = field('[data-field="shell.clipboardShareDestinationIds"]') as HTMLInputElement | null;
    const shellApplyRemoteDevice = field('[data-field="shell.applyRemoteClipboardToDevice"]') as HTMLInputElement | null;
    const shellAcceptContactsBridge = field('[data-field="shell.acceptContactsBridgeData"]') as HTMLInputElement | null;
    const shellAcceptSmsBridge = field('[data-field="shell.acceptSmsBridgeData"]') as HTMLInputElement | null;
    const shellSms = field('[data-field="shell.enableNativeSms"]') as HTMLInputElement | null;
    const shellContacts = field('[data-field="shell.enableNativeContacts"]') as HTMLInputElement | null;
    const adminPreview = root.querySelector("[data-admin-preview]") as HTMLElement | null;
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

    root.addEventListener("input", (ev) => {
        const el = ev.target as HTMLElement | null;
        if (el?.matches?.('[data-field^="core."]')) refreshAdminDoorPreview();
    });
    root.addEventListener("change", (ev) => {
        const el = ev.target as HTMLElement | null;
        if (el?.matches?.('[data-field^="core."]')) refreshAdminDoorPreview();
    });

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
        const availableTabs = new Set(["appearance", "markdown", "ai", "mcp", "server", "instructions", "extension"]);
        return availableTabs.has(normalized) ? normalized : "ai";
    };

    const buildCoreSnapshotForAdminPreview = (): AppSettings["core"] => ({
        mode: ((coreMode?.value as CoreMode) || "native") as CoreMode,
        endpointUrl: coreEndpointUrl?.value?.trim() || "",
        userId: coreUserId?.value?.trim() || "",
        userKey: coreUserKey?.value?.trim() || "",
        encrypt: Boolean(coreEncrypt?.checked),
        preferBackendSync: (corePreferBackendSync?.checked ?? true) !== false,
        appClientId: coreAppClientId?.value?.trim() || "",
        allowInsecureTls: Boolean(coreAllowInsecureTls?.checked),
        useCoreIdentityForAirPad: (coreUseCoreIdentityAirpad?.checked ?? true) !== false,
        socket: {
            accessToken: coreSocketAccessToken?.value?.trim() || "",
            routeTarget: coreSocketRouteTarget?.value?.trim() || "",
            selfId: "",
            clientAccessToken: coreSocketClientAccessToken?.value?.trim() || "",
            allowAccessTokenWithoutUserKey: Boolean(coreSocketAllowAccessWithoutUserKey?.checked),
        },
        admin: {
            httpsOrigin: coreAdminHttps?.value?.trim() || "",
            httpOrigin: coreAdminHttp?.value?.trim() || "",
            path: coreAdminPath?.value?.trim() || "/",
        },
        ops: {
            allowUnencrypted: Boolean(coreOpsAllowUnencrypted?.checked),
        },
    });

    const refreshAdminDoorPreview = () => {
        if (!adminPreview) return;
        const urls = resolveAdminDoorUrls(buildCoreSnapshotForAdminPreview());
        adminPreview.textContent = `Resolved: ${urls.https} · ${urls.http}`;
    };

    const openExplorerPath = (path: string) => {
        try {
            setString(StorageKeys.EXPLORER_PATH, path);
            navigateToView("explorer");
            void sendMessage({
                type: "content-explorer",
                destination: "explorer",
                data: {
                    action: "view",
                    path
                },
                metadata: {
                    source: "settings"
                }
            });
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
            if (coreMode) coreMode.value = (s?.core?.mode || "native") as string;
            if (coreEndpointUrl) coreEndpointUrl.value = (s?.core?.endpointUrl || "").trim();
            if (coreUserId) coreUserId.value = (s?.core?.userId || "").trim();
            if (coreUserKey) coreUserKey.value = (s?.core?.userKey || "").trim();
            if (corePreferBackendSync) corePreferBackendSync.checked = (s?.core?.preferBackendSync ?? true) !== false;
            if (coreEncrypt) coreEncrypt.checked = Boolean(s?.core?.encrypt);
            if (coreAppClientId) coreAppClientId.value = (s?.core?.appClientId || "").trim();
            if (coreUseCoreIdentityAirpad) coreUseCoreIdentityAirpad.checked = (s?.core?.useCoreIdentityForAirPad ?? true) !== false;
            if (coreSocketAccessToken) {
                coreSocketAccessToken.value = (
                    (s?.core?.socket?.accessToken || s?.core?.socket?.airpadAuthToken || "") as string
                ).trim();
            }
            if (coreSocketRouteTarget) {
                coreSocketRouteTarget.value = (
                    (s?.core?.socket?.routeTarget || s?.core?.socket?.selfId || "") as string
                ).trim();
            }
            if (coreSocketClientAccessToken) {
                coreSocketClientAccessToken.value = (s?.core?.socket?.clientAccessToken || "").trim();
            }
            if (coreSocketAllowAccessWithoutUserKey) {
                coreSocketAllowAccessWithoutUserKey.checked =
                    (s?.core?.socket?.allowAccessTokenWithoutUserKey ?? false) === true;
            }
            if (coreAllowInsecureTls) coreAllowInsecureTls.checked = Boolean(s?.core?.allowInsecureTls);
            if (coreOpsAllowUnencrypted) coreOpsAllowUnencrypted.checked = Boolean(s?.core?.ops?.allowUnencrypted);
            if (coreAdminHttps) coreAdminHttps.value = (s?.core?.admin?.httpsOrigin || "").trim();
            if (coreAdminHttp) coreAdminHttp.value = (s?.core?.admin?.httpOrigin || "").trim();
            if (coreAdminPath) coreAdminPath.value = (s?.core?.admin?.path || "/").trim() || "/";
            if (shellMaintainHubSocket) shellMaintainHubSocket.checked = Boolean(s?.shell?.maintainHubSocketConnection);
            if (shellClipboardBroadcastTargets) {
                shellClipboardBroadcastTargets.value = (s?.shell?.clipboardBroadcastTargets || "").trim();
            }
            if (shellPushLocalClipboard) {
                shellPushLocalClipboard.checked = Boolean(s?.shell?.pushLocalClipboardToLan);
            }
            if (shellClipboardPushIntervalMs) {
                const iv = Number(s?.shell?.clipboardPushIntervalMs);
                shellClipboardPushIntervalMs.value = String(
                    Number.isFinite(iv) && iv >= 800 ? Math.min(Math.round(iv), 60000) : 2000
                );
            }
            if (shellClipboard) shellClipboard.checked = (s?.shell?.enableRemoteClipboardBridge ?? true) !== false;
            if (shellAcceptInboundClipboard) {
                shellAcceptInboundClipboard.checked = (s?.shell?.acceptInboundClipboardData ?? true) !== false;
            }
            if (shellClipboardInboundAllowIds) {
                shellClipboardInboundAllowIds.value = (s?.shell?.clipboardInboundAllowIds || "").trim();
            }
            if (shellAccessTokenBypassClipboardAllow) {
                shellAccessTokenBypassClipboardAllow.checked =
                    (s?.shell?.accessTokenBypassesClipboardAllowlist ?? false) === true;
            }
            if (shellClipboardShareDestIds) {
                shellClipboardShareDestIds.value = (s?.shell?.clipboardShareDestinationIds || "").trim();
            }
            if (shellApplyRemoteDevice) shellApplyRemoteDevice.checked = (s?.shell?.applyRemoteClipboardToDevice ?? true) !== false;
            if (shellAcceptContactsBridge) {
                shellAcceptContactsBridge.checked = (s?.shell?.acceptContactsBridgeData ?? false) === true;
            }
            if (shellAcceptSmsBridge) {
                shellAcceptSmsBridge.checked = (s?.shell?.acceptSmsBridgeData ?? false) === true;
            }
            if (shellSms) shellSms.checked = (s?.shell?.enableNativeSms ?? true) !== false;
            if (shellContacts) shellContacts.checked = (s?.shell?.enableNativeContacts ?? true) !== false;
            refreshAdminDoorPreview();
            renderMcpConfigurations(Array.isArray(s?.ai?.mcp) ? s.ai.mcp : []);
            applyAirpadRuntimeFromAppSettings(s);
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

        const openAdminHttpsBtn = t?.closest?.('button[data-action="open-admin-https"]') as HTMLButtonElement | null;
        if (openAdminHttpsBtn) {
            openAdminDoorFromCore(buildCoreSnapshotForAdminPreview(), "https");
            return;
        }

        const openAdminHttpBtn = t?.closest?.('button[data-action="open-admin-http"]') as HTMLButtonElement | null;
        if (openAdminHttpBtn) {
            openAdminDoorFromCore(buildCoreSnapshotForAdminPreview(), "http");
            return;
        }

        const copyAdminHttpsBtn = t?.closest?.('button[data-action="copy-admin-https"]') as HTMLButtonElement | null;
        if (copyAdminHttpsBtn) {
            const urls = resolveAdminDoorUrls(buildCoreSnapshotForAdminPreview());
            void navigator.clipboard?.writeText?.(urls.https).then(
                () => setNote("HTTPS admin URL copied."),
                () => setNote("Copy failed.")
            );
            return;
        }

        const copyAdminHttpBtn = t?.closest?.('button[data-action="copy-admin-http"]') as HTMLButtonElement | null;
        if (copyAdminHttpBtn) {
            const urls = resolveAdminDoorUrls(buildCoreSnapshotForAdminPreview());
            void navigator.clipboard?.writeText?.(urls.http).then(
                () => setNote("HTTP admin URL copied."),
                () => setNote("Copy failed.")
            );
            return;
        }

        const openNativeSettingsBtn = t?.closest?.('button[data-action="open-native-app-settings"]') as HTMLButtonElement | null;
        if (openNativeSettingsBtn) {
            void import("@shared/native/clipboard-device")
                .then((m) => m.openAppClipboardRelatedSettings())
                .then(() => setNote("App settings opened (native shell only)."))
                .catch(() => setNote("Native settings unavailable in this context."));
            return;
        }

        const openNativeNotifBtn = t?.closest?.('button[data-action="open-native-notification-settings"]') as HTMLButtonElement | null;
        if (openNativeNotifBtn) {
            void import("@shared/native/clipboard-device")
                .then((m) => m.openNativeNotificationSettings?.())
                .then(() => setNote("Notification settings opened (native shell only)."))
                .catch(() => setNote("Native settings unavailable in this context."));
            return;
        }

        const btn = t?.closest?.('button[data-action="save"]') as HTMLButtonElement | null;
        if (!btn) return;

        void (async () => {
            const current = await loadSettings();
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
                    ...current.core,
                    ntpEnabled: readCheckboxValue(ntpEnabled, Boolean(current.core?.ntpEnabled)),
                    mode: (readTrimmedControlValue(coreMode, (current.core?.mode || "native") as string) || "native") as CoreMode,
                    endpointUrl: readTrimmedControlValue(coreEndpointUrl, current.core?.endpointUrl || ""),
                    userId: readTrimmedControlValue(coreUserId, current.core?.userId || ""),
                    userKey: readTrimmedControlValue(coreUserKey, current.core?.userKey || ""),
                    encrypt: readCheckboxValue(coreEncrypt, Boolean(current.core?.encrypt)),
                    preferBackendSync: readCheckboxValue(corePreferBackendSync, (current.core?.preferBackendSync ?? true) !== false),
                    appClientId: readTrimmedControlValue(coreAppClientId, current.core?.appClientId || ""),
                    allowInsecureTls: readCheckboxValue(coreAllowInsecureTls, Boolean(current.core?.allowInsecureTls)),
                    useCoreIdentityForAirPad: readCheckboxValue(coreUseCoreIdentityAirpad, (current.core?.useCoreIdentityForAirPad ?? true) !== false),
                    socket: (() => {
                        const prev = { ...(current.core?.socket || {}) };
                        delete (prev as { airpadAuthToken?: string }).airpadAuthToken;
                        return {
                            ...prev,
                            accessToken: readTrimmedControlValue(
                                coreSocketAccessToken,
                                current.core?.socket?.accessToken || current.core?.socket?.airpadAuthToken || ""
                            ),
                            routeTarget: readTrimmedControlValue(coreSocketRouteTarget, current.core?.socket?.routeTarget || ""),
                            selfId: "",
                            clientAccessToken: readTrimmedControlValue(
                                coreSocketClientAccessToken,
                                current.core?.socket?.clientAccessToken || ""
                            ),
                            allowAccessTokenWithoutUserKey: readCheckboxValue(
                                coreSocketAllowAccessWithoutUserKey,
                                Boolean(current.core?.socket?.allowAccessTokenWithoutUserKey)
                            ),
                        };
                    })(),
                    admin: {
                        ...(current.core?.admin || {}),
                        httpsOrigin: readTrimmedControlValue(coreAdminHttps, current.core?.admin?.httpsOrigin || ""),
                        httpOrigin: readTrimmedControlValue(coreAdminHttp, current.core?.admin?.httpOrigin || ""),
                        path: readTrimmedControlValue(coreAdminPath, current.core?.admin?.path || "/") || "/",
                    },
                    ops: {
                        ...(current.core?.ops || {}),
                        allowUnencrypted: readCheckboxValue(coreOpsAllowUnencrypted, Boolean(current.core?.ops?.allowUnencrypted)),
                    },
                },
                shell: {
                    ...(current.shell || {}),
                    maintainHubSocketConnection: readCheckboxValue(shellMaintainHubSocket, Boolean(current.shell?.maintainHubSocketConnection)),
                    clipboardBroadcastTargets: readTrimmedControlValue(
                        shellClipboardBroadcastTargets,
                        current.shell?.clipboardBroadcastTargets || ""
                    ),
                    pushLocalClipboardToLan: readCheckboxValue(
                        shellPushLocalClipboard,
                        Boolean(current.shell?.pushLocalClipboardToLan)
                    ),
                    clipboardPushIntervalMs: (() => {
                        const raw = shellClipboardPushIntervalMs?.value;
                        const n = parseNumberOrDefault(raw, current.shell?.clipboardPushIntervalMs ?? 2000);
                        return Math.min(60000, Math.max(800, Math.round(n)));
                    })(),
                    enableRemoteClipboardBridge: readCheckboxValue(shellClipboard, (current.shell?.enableRemoteClipboardBridge ?? true) !== false),
                    acceptInboundClipboardData: readCheckboxValue(
                        shellAcceptInboundClipboard,
                        (current.shell?.acceptInboundClipboardData ?? true) !== false
                    ),
                    clipboardInboundAllowIds: readTrimmedControlValue(
                        shellClipboardInboundAllowIds,
                        current.shell?.clipboardInboundAllowIds || ""
                    ),
                    accessTokenBypassesClipboardAllowlist: readCheckboxValue(
                        shellAccessTokenBypassClipboardAllow,
                        Boolean(current.shell?.accessTokenBypassesClipboardAllowlist)
                    ),
                    clipboardShareDestinationIds: readTrimmedControlValue(
                        shellClipboardShareDestIds,
                        current.shell?.clipboardShareDestinationIds || ""
                    ),
                    applyRemoteClipboardToDevice: readCheckboxValue(shellApplyRemoteDevice, (current.shell?.applyRemoteClipboardToDevice ?? true) !== false),
                    acceptContactsBridgeData: readCheckboxValue(
                        shellAcceptContactsBridge,
                        Boolean(current.shell?.acceptContactsBridgeData)
                    ),
                    acceptSmsBridgeData: readCheckboxValue(shellAcceptSmsBridge, Boolean(current.shell?.acceptSmsBridgeData)),
                    enableNativeSms: readCheckboxValue(shellSms, (current.shell?.enableNativeSms ?? true) !== false),
                    enableNativeContacts: readCheckboxValue(shellContacts, (current.shell?.enableNativeContacts ?? true) !== false),
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
            void import("@shared/transport/hub-socket-boot").then((m) => m.applyHubSocketFromSettings(saved));
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
