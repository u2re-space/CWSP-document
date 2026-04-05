import type { SectionConfig } from "@rs-com/config/SettingsTypes";

export const RuntimeSection: SectionConfig = {
    key: "runtime",
    title: "Runtime",
    icon: "server",
    description: "Endpoint mode, credentials, and remote ops wiring.",
    groups: [
        {
            key: "runtime-mode",
            label: "Runtime mode",
            description: "Choose whether to run native or use a remote endpoint.",
            fields: [
                {
                    path: "core.mode",
                    label: "Mode",
                    type: "select",
                    options: [
                        { value: "native", label: "Native (standalone)" },
                        { value: "endpoint", label: "Endpoint (remote server)" }
                    ]
                },
                { path: "core.endpointUrl", label: "Endpoint URL", type: "text", placeholder: "https://api.example.com" }
            ]
        },
        {
            key: "share-target",
            label: "Share target action",
            description: "Pick which action runs for incoming share-target posts.",
            fields: [
                {
                    path: "ai.shareTargetMode",
                    label: "Share target action",
                    type: "select",
                    options: [
                        { value: "analyze", label: "Analyze" },
                        { value: "recognize", label: "Recognize" }
                    ]
                }
            ]
        },
        {
            key: "endpoint-access",
            label: "Endpoint access",
            description: "Credentials for shared endpoint mode.",
            fields: [
                { path: "core.userId", label: "User ID", type: "text", placeholder: "device-123" },
                { path: "core.userKey", label: "User Key", type: "password", placeholder: "generated key" },
                {
                    path: "core.encrypt",
                    label: "Encrypt stored files",
                    type: "select",
                    options: [
                        { value: "false", label: "Disabled" },
                        { value: "true", label: "Enabled" }
                    ]
                },
                {
                    path: "core.preferBackendSync",
                    label: "Use backend storage for sync",
                    type: "select",
                    options: [
                        { value: "true", label: "Prefer backend" },
                        { value: "false", label: "Use local/WebDAV" }
                    ]
                }
            ]
        },
        {
            key: "remote-ops",
            label: "Remote operations",
            description: "Configure HTTP/WS targets for sync/automation.",
            fields: [
                {
                    path: "core.ops.allowUnencrypted",
                    label: "Allow HTTP (unencrypted)",
                    type: "select",
                    options: [
                        { value: "false", label: "Disallow" },
                        { value: "true", label: "Allow HTTP" }
                    ]
                },
                {
                    path: "core.ops.httpTargets",
                    label: "HTTP targets (JSON)",
                    type: "textarea",
                    placeholder: `[{"id":"macro","url":"https://example.com/hook","method":"POST","headers":{"X-Key":"..."},"unencrypted":false}]`
                },
                {
                    path: "core.ops.wsTargets",
                    label: "WebSocket targets (JSON)",
                    type: "textarea",
                    placeholder: `[{"id":"ws-1","url":"wss://example.com/ws"}]`
                },
                {
                    path: "core.ops.syncTargets",
                    label: "Sync targets (JSON)",
                    type: "textarea",
                    placeholder: `[{"id":"sync-1","url":"https://example.com/sync"}]`
                }
            ]
        }
    ]
};
