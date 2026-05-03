import { H } from "fest/lure";
import type { MCPConfig } from "com/config/SettingsTypes";

export const createMcpRow = (cfg: MCPConfig) => {
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

export const collectMcpConfigurations = (mcpSection: HTMLElement | null) => {
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

export const renderMcpConfigurations = (mcpSection: HTMLElement | null, configs: MCPConfig[]) => {
    if (!mcpSection) return;
    mcpSection.replaceChildren();
    const list = Array.isArray(configs) ? configs : [];
    if (!list.length) {
        mcpSection.appendChild(H`<p class="mcp-empty-note">No MCP servers configured.</p>` as HTMLElement);
        return;
    }
    list.forEach((cfg) => mcpSection.appendChild(createMcpRow(cfg)));
};
