import { SETTINGS_FILE } from "../lib/paths.ts";
import { createSettingsStore } from "../lib/settings.ts";
import type { Settings } from "../lib/settings.ts";
import type { PortableConfigSeed } from "./schema.ts";
import { FALLBACK_ROLES, FALLBACK_RUNTIME_DEFAULTS, FALLBACK_TOPOLOGY, FALLBACK_BRIDGE, FALLBACK_BRIDGE_ENDPOINTS } from "../lib/config-defaults.ts";
import { parsePortableBoolean, parsePortableInteger } from "../lib/parsing.ts";
import {
    asRecord,
    createEndpointConfigSanitizer,
    discoverEndpointConfig,
    loadLegacyEndpointIds,
    loadPortableConfig,
    loadPortableEndpointSeed,
    normalizeTopologyCollection,
    toStringArray,
    getConfigLoadReport
} from "./utils.ts";

const portableConfig = loadPortableConfig();
const portableCoreSection = asRecord(portableConfig && typeof portableConfig === "object" ? (portableConfig as Record<string, any>).core : undefined);
const portableEndpointSection = asRecord(portableConfig && typeof portableConfig === "object" ? (portableConfig as Record<string, any>).endpoint : undefined);
const portableEndpointDefaults = asRecord(portableConfig && typeof portableConfig === "object" && "endpointDefaults" in portableConfig ? (portableConfig as Record<string, any>).endpointDefaults : undefined) as
    | {
        roles?: unknown;
        bridge?: unknown;
    }
    | undefined;
const portableRuntimeDefaults = asRecord(portableConfig && typeof portableConfig === "object" ? ((portableConfig as Record<string, any>).endpointRuntimeDefaults ?? (portableConfig as Record<string, any>).endpointRuntime ?? (portableEndpointSection as Record<string, any>).runtime ?? (portableCoreSection as Record<string, any>).runtime) : undefined) as {
    listenPort?: unknown;
    httpPort?: unknown;
    broadcastForceHttps?: unknown;
    peers?: unknown;
    broadcastTargets?: unknown;
    clipboardPeerTargets?: unknown;
    pollInterval?: unknown;
    httpTimeoutMs?: unknown;
    secret?: unknown;
};

const portableTopology =
    (portableConfig && typeof portableConfig === "object" && "endpointTopology" in portableConfig ? (portableConfig as Record<string, any>).endpointTopology : portableConfig && typeof portableConfig === "object" && "topology" in portableConfig ? (portableConfig as Record<string, any>).topology : undefined) ||
    (portableEndpointSection as Record<string, any>).topology ||
    (portableCoreSection as Record<string, any>).topology;
const portableRoles = toStringArray(portableEndpointDefaults?.roles) || toStringArray(portableCoreSection.roles) || toStringArray(portableEndpointSection.roles);
const portableBridge =
    (portableEndpointSection as Record<string, any>).bridge ||
    (portableCoreSection as Record<string, any>).bridge ||
    (portableEndpointDefaults as Record<string, any>).bridge ||
    {};
const portableBridgeEndpoints = toStringArray((portableBridge as Record<string, any>)?.endpoints) || toStringArray(FALLBACK_BRIDGE_ENDPOINTS);
const portablePeers = toStringArray((portableRuntimeDefaults as Record<string, any>).peers) || toStringArray((portableEndpointSection as Record<string, any>).peers);
const portableBroadcastTargets = toStringArray((portableRuntimeDefaults as Record<string, any>).broadcastTargets) || toStringArray((portableEndpointSection as Record<string, any>).broadcastTargets);
const portableClipboardPeerTargets = toStringArray((portableRuntimeDefaults as Record<string, any>).clipboardPeerTargets) || toStringArray((portableEndpointSection as Record<string, any>).clipboardPeerTargets);
const portableListenPort = (portableRuntimeDefaults as Record<string, any>)?.listenPort;
const portableHttpPort = (portableRuntimeDefaults as Record<string, any>)?.httpPort;
const portableBroadcastForceHttps = (portableRuntimeDefaults as Record<string, any>)?.broadcastForceHttps;
const portablePollInterval = (portableRuntimeDefaults as Record<string, any>)?.pollInterval;
const portableHttpTimeoutMs = (portableRuntimeDefaults as Record<string, any>)?.httpTimeoutMs;
const portableSecret = (portableRuntimeDefaults as Record<string, any>)?.secret;

const portableTopologyConfig =
    portableTopology && typeof portableTopology === "object"
        ? {
            enabled: parsePortableBoolean((portableTopology as Record<string, any>).enabled) ?? true,
            nodes: normalizeTopologyCollection((portableTopology as Record<string, any>).nodes).map((entry) => entry as Record<string, any>),
            links: normalizeTopologyCollection((portableTopology as Record<string, any>).links).map((entry) => entry as Record<string, any>)
        }
        : undefined;

export const DEFAULT_CORE_ROLES = [...(portableRoles || FALLBACK_ROLES)] as const;

export const DEFAULT_BRIDGE_ENDPOINTS = [...(portableBridgeEndpoints || FALLBACK_BRIDGE_ENDPOINTS)] as const;

export const DEFAULT_ENDPOINT_BRIDGE = {
    ...FALLBACK_BRIDGE,
    ...(typeof portableBridge === "object" && portableBridge ? portableBridge : {}),
    endpointUrl: typeof (portableBridge as Record<string, any>)?.endpointUrl === "string" && (portableBridge as Record<string, any>).endpointUrl.trim() ? (portableBridge as Record<string, any>).endpointUrl : DEFAULT_BRIDGE_ENDPOINTS[0],
    endpoints: DEFAULT_BRIDGE_ENDPOINTS
};

export const DEFAULT_ENDPOINT_RUNTIME = {
    ...FALLBACK_RUNTIME_DEFAULTS,
    listenPort: parsePortableInteger(portableListenPort) ?? FALLBACK_RUNTIME_DEFAULTS.listenPort,
    httpPort: parsePortableInteger(portableHttpPort) ?? FALLBACK_RUNTIME_DEFAULTS.httpPort,
    broadcastForceHttps: parsePortableBoolean(portableBroadcastForceHttps) ?? FALLBACK_RUNTIME_DEFAULTS.broadcastForceHttps,
    peers: portablePeers || FALLBACK_RUNTIME_DEFAULTS.peers,
    broadcastTargets: portableBroadcastTargets || FALLBACK_RUNTIME_DEFAULTS.broadcastTargets,
    clipboardPeerTargets: portableClipboardPeerTargets || FALLBACK_RUNTIME_DEFAULTS.clipboardPeerTargets,
    pollInterval: parsePortableInteger(portablePollInterval) ?? FALLBACK_RUNTIME_DEFAULTS.pollInterval,
    httpTimeoutMs: parsePortableInteger(portableHttpTimeoutMs) ?? FALLBACK_RUNTIME_DEFAULTS.httpTimeoutMs,
    secret: typeof portableSecret === "string" ? portableSecret : FALLBACK_RUNTIME_DEFAULTS.secret
};

export const DEFAULT_ENDPOINT_TOPOLOGY: {
    enabled: boolean;
    nodes: Array<Record<string, any>>;
    links: Array<Record<string, any>>;
} = {
    enabled: portableTopologyConfig?.enabled ?? FALLBACK_TOPOLOGY.enabled,
    nodes: portableTopologyConfig?.nodes ? [...portableTopologyConfig.nodes] : [...FALLBACK_TOPOLOGY.nodes].map((entry) => entry as Record<string, any>),
    links: portableTopologyConfig?.links ? [...portableTopologyConfig.links] : [...FALLBACK_TOPOLOGY.links].map((entry) => entry as Record<string, any>)
};

export const DEFAULT_SETTINGS: Settings = {
    core: {
        roles: [...DEFAULT_CORE_ROLES],
        topology: {
            ...DEFAULT_ENDPOINT_TOPOLOGY
        },
        bridge: {
            ...DEFAULT_ENDPOINT_BRIDGE
        }
    },
    ai: { customInstructions: [], activeInstructionId: "" },
    webdav: { url: "", username: undefined, password: undefined },
    timeline: { enabled: false },
    appearance: { theme: "", language: "" },
    speech: { voice: "" },
    grid: { columns: 0, rows: 0 }
};

const settingsStore = createSettingsStore(SETTINGS_FILE, DEFAULT_SETTINGS);
export const readCoreSettings = settingsStore.readCoreSettings;
export const writeCoreSettings = settingsStore.writeCoreSettings;

const portableSeed: PortableConfigSeed = loadPortableEndpointSeed();
const legacyEndpointIDs = loadLegacyEndpointIds();
const getConfigLoadReportSnapshot = () => getConfigLoadReport();

const defaultConfig = {
    // На каком порту слушаем входящие HTTP запросы
    listenPort: DEFAULT_ENDPOINT_RUNTIME.listenPort,

    // На каком порту слушаем входящие НЕ-HTTPS (HTTP) запросы (эндпоинты, Socket.IO)
    // Нужно для совместимости/простых клиентов в локальной сети: http://host:8080/clipboard
    httpPort: DEFAULT_ENDPOINT_RUNTIME.httpPort,
    // По умолчанию в broadcast пытаемся использовать HTTPS для портов 443/8443
    broadcastForceHttps: DEFAULT_ENDPOINT_RUNTIME.broadcastForceHttps,

    // Список получателей (URL/IP/host), куда рассылаем изменения клипборда.
    // Формат может быть URL или хост/IP; без схемы будут пробованы https и http варианты.
    peers: DEFAULT_ENDPOINT_RUNTIME.peers,
    // Список маршрутов/идентификаторов получателей для /api/network/dispatch.
    // Формат: id, deviceId, label или любой дополнительный токен цели.
    // Будет использован как implicit список при broadcast=true.
    broadcastTargets: [...DEFAULT_ENDPOINT_RUNTIME.broadcastTargets],
    // Список вариантов схема:порт, которые пробуются для peers без явного порта/схемы.
    // Формат: "https:443", "https:8443", "http:8080", "http:80"
    clipboardPeerTargets: [...DEFAULT_ENDPOINT_RUNTIME.clipboardPeerTargets],

    // Интервал опроса системного буфера (мс)
    pollInterval: DEFAULT_ENDPOINT_RUNTIME.pollInterval,

    // Таймаут для исходящих HTTP запросов к peers (мс)
    // 3000мс часто мало для мобильных устройств/спящих девайсов/первого пробуждения сети.
    httpTimeoutMs: DEFAULT_ENDPOINT_RUNTIME.httpTimeoutMs,

    // Простейшая защита: токен (по желанию, можно оставить пустым)
    secret: DEFAULT_ENDPOINT_RUNTIME.secret,

    // Роли/режимы этого узла:
    // - endpoint: full endpoint behavior
    // - server-facing roles:
    //   - requestor-initiated: принимает обычные прямые push-сессии (клиенты requestor-initiator)
    //   - responser-initiated: принимает uplink-сессии и инициализирующие keepalive на локальных/Web-сессиях
    // - client-facing roles:
    //   - requestor-initiator: подключается как push-инициатор
    //   - responser-initiator: подключается как reverse-инициатор
    // - peer: participate as a peer device
    // - hub: acts as relay participant and/or gateway origin role
    // - node: generic aggregate role
    // - first-order / exchanger-initiator: bidirectional compatibility negotiation mode
    // - server: legacy alias for server-initiated role naming
    // - client: legacy alias for client-initiated role naming
    // - compatibility aliases for mixed stacks:
    //   - forward-client <=> requestor-initiator
    //   - reverse-client <=> responser-initiator
    //   - forward-server <=> responser-initiated
    //   - reverse-server <=> requestor-initiated
    roles: [...DEFAULT_CORE_ROLES],

    // Bridge tunnel-through / be-as-device settings.
    // Connector/Client roles:
    // - active|keepalive (default): opens outbound reverse WS и держит keepalive (CWS_BRIDGE_ENABLED + CWS_BRIDGE_MODE=active)
    // - passive: no outbound WS, endpoint only consumes direct private/local/gateway traffic
    // Gateway/Origin (куда подключается) на своей стороне выступает как reverse receiver и проксирует между peer-клиентами.
    // Когда active: endpoint откроет reverse WS на gateway-узел.
    bridge: {
        ...(DEFAULT_SETTINGS.core?.bridge || {}),
        ...DEFAULT_ENDPOINT_BRIDGE,
        // Основные адреса для hub/server/endpoint подключения:
        // 1) внешний endpoint hub (дефолт)
        // 2) локальный fallback для LAN
        endpoints: [...DEFAULT_BRIDGE_ENDPOINTS],
        endpointUrl: DEFAULT_ENDPOINT_BRIDGE.endpointUrl
    },
    topology: {
        ...DEFAULT_ENDPOINT_TOPOLOGY
    },
    endpointIDs: {}
};

const sanitizeEndpointConfig = createEndpointConfigSanitizer({ defaultConfig, portableSeed, legacyEndpointIDs });

export default discoverEndpointConfig({
    defaultConfig,
    sanitizeConfig: sanitizeEndpointConfig
}) as Record<string, any>;

export { getConfigLoadReportSnapshot };

export type {
    AppSettings,
    CustomInstruction,
    CoreSettings,
    Settings,
    AiSettings,
    WebdavSettings,
    TimelineSettings,
    AppearanceSettings,
    SpeechSettings,
    GridSettings
} from "../lib/settings.ts";
export { createSettingsStore, mergeSettings, makeSettingsMerger } from "../lib/settings.ts";
