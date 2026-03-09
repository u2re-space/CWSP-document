export type EndpointHttpsConfig = {
    enabled?: boolean;
    key?: string;
    cert?: string;
    ca?: string;
    keyFile?: string;
    keyPath?: string;
    certFile?: string;
    certPath?: string;
    caFile?: string;
    caPath?: string;
    requestClientCerts?: boolean;
    allowUntrustedClientCerts?: boolean;
};

export type EndpointTopologyConfig = {
    enabled?: boolean;
    nodes?: Array<Record<string, any>>;
    links?: Array<Record<string, any>>;
};

export type EndpointBridgeOriginConfig = {
    originId?: string;
    originHosts?: string[];
    originDomains?: string[];
    originMasks?: string[];
    surface?: string;
};

export type EndpointBridgeConfig = {
    enabled?: boolean;
    mode?: "active" | "passive";
    origin?: EndpointBridgeOriginConfig;
    endpointUrl?: string;
    endpoints?: string[];
    userId?: string;
    userKey?: string;
    bridgeMasterKey?: string;
    bridgeSigningPrivateKeyPem?: string;
    bridgePeerPublicKeyPem?: string;
    deviceId?: string;
    clientId?: string;
    namespace?: string;
    reconnectMs?: number;
};

export type EndpointIdPolicy = {
    id: string;
    origins: string[];
    tokens: string[];
    forward: string;
    ports?: Record<string, unknown>;
    flags: {
        mobile?: boolean;
        gateway?: boolean;
        direct?: boolean;
    };
    allowedIncoming: string[];
    allowedOutcoming: string[];
    roles?: string[];
};

export type EndpointConfig = {
    listenPort?: number;
    httpPort?: number;
    broadcastForceHttps?: boolean;
    peers?: string[];
    broadcastTargets?: string[];
    https?: EndpointHttpsConfig;
    networkAliases?: Record<string, string>;
    clipboardPeerTargets?: string[];
    topology?: EndpointTopologyConfig;
    endpointIDs?: Record<string, EndpointIdPolicy>;
    pollInterval?: number;
    httpTimeoutMs?: number;
    secret?: string;
    roles?: string[];
    bridge?: EndpointBridgeConfig;
    ai?: Record<string, any>;
};

export type PortableConfigSeed = {
    endpoint?: Record<string, any>;
    core?: Record<string, any>;
    network?: Record<string, any>;
    runtime?: Record<string, any>;
    endpointDefaults?: Record<string, any>;
    endpointRuntimeDefaults?: Record<string, any>;
    endpointTopology?: unknown;
    networkAliases?: unknown;
    networkAliasMap?: unknown;
    topology?: unknown;
    bridge?: unknown;
    roles?: unknown;
    peers?: unknown;
    broadcastTargets?: unknown;
    https?: unknown;
    clipboardPeerTargets?: unknown;
    listenPort?: unknown;
    httpPort?: unknown;
    broadcastForceHttps?: unknown;
    pollInterval?: unknown;
    httpTimeoutMs?: unknown;
    secret?: unknown;
    endpointIDs?: Record<string, any>;
};
