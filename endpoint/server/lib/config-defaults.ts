export const FALLBACK_ROLES = ["endpoint", "server", "peer", "client", "node", "hub"] as const;

export const FALLBACK_BRIDGE_ENDPOINTS = ["https://45.147.121.152:8443/", "https://192.168.0.200:8443/"] as const;

export const FALLBACK_BRIDGE = {
    enabled: true,
    endpointUrl: FALLBACK_BRIDGE_ENDPOINTS[0],
    userId: "",
    userKey: "",
    bridgeMasterKey: "",
    bridgeSigningPrivateKeyPem: "",
    bridgePeerPublicKeyPem: "",
    deviceId: "L-192.168.0.200",
    namespace: "default",
    reconnectMs: 5000
} as const;

export const FALLBACK_RUNTIME_DEFAULTS = {
    listenPort: 8443,
    httpPort: 8080,
    broadcastForceHttps: true,
    peers: ["100.81.105.5", "100.90.155.65", "192.168.0.196", "192.168.0.208", "192.168.0.200", "192.168.0.110", "45.147.121.152"],
    broadcastTargets: [],
    clipboardPeerTargets: ["https:443", "https:8443", "http:8080", "http:80"],
    pollInterval: 100,
    httpTimeoutMs: 10000,
    secret: ""
} as const;

export const FALLBACK_TOPOLOGY = {
    enabled: true,
    nodes: [],
    links: []
} as const;

export const DEFAULT_CORE_ROLES = [...FALLBACK_ROLES] as const;
