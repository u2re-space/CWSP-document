# Endpoint Network Subsystem

This folder owns the endpoint network layer used by CrossWord. It centralizes protocol contract, policy enforcement, routing, and transport lifecycle so HTTP, Socket.IO, WebSocket, and reverse tunnel peers behave consistently.

## 1) Config entry and runtime inputs

Runtime networking settings are loaded by `server/config/config.ts` through the portable config chain.

- `portable.config.json` defines module links (`portableModules` style references)
- `portable-core.json` usually points identity/network sources:
  - `endpointIDs: fs:./clients.json`
  - `gateways: fs:./gateways.json`
  - `network: fs:./network.json`
- `portable-endpoint.json` often delegates runtime input to `network.json`:
  - `"endpoint": "fs:./network.json"`
- `network.json` carries shared transport policy (`allowedOrigins`, TLS options, aliases, upstream behavior)

### Compact value syntax

- `fs:<path>` or `file:<path>` — load value from file
- `inline:<value>` — inline raw value
- `inline:'<value>'` / `inline:"<value>"` — preserve spaces and escapes
- `env:<NAME>` — inject environment value at startup
- `data:<...>` — URI/data payloads (including base64 sections)
- `http://...` / `https://...` — raw URL passthrough

### Env variable naming

- Preferred: `CWS_*`
- Compatibility: `AIRPAD_*` where explicitly mapped

If `key`, `cert`, or `ca` arrive without PEM boundaries, loader auto-adds defaults:

- `PRIVATE KEY` for keys
- `CERTIFICATE` for cert/ca values

### Example

```json
{
  "core": "fs:./portable-core.json",
  "endpoint": "fs:./portable-endpoint.json",
  "endpointRuntime": {
    "https": {
      "enabled": "env:CWS_HTTPS_ENABLED",
      "key": "fs:${env:CWS_HTTPS_KEY_PATH}",
      "cert": "inline:'-----BEGIN CERTIFICATE-----\\n...\\n-----END CERTIFICATE-----'",
      "ca": "data:text/plain;base64,LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCg...",
      "requestClientCerts": "inline:true",
      "allowUntrustedClientCerts": "inline:false"
    }
  }
}
```

## 2) Design goals

- one protocol language across all transports
- one transport-agnostic frame model
- shared routing and policy logic
- transport-specific behavior only at boundary modules
- compatibility shims preserved for older imports while new canonical logic stays in `network/*`

## 3) Directory map

- `http/` — HTTP lifecycle and TLS helpers
- `socket/` — Socket.IO and WebSocket transport internals
- `tunnel/` — reverse connector and upstream bridge helpers
- `protocol/` — frame/message schema and normalization utilities
- `topology.ts` — topology helpers and route intent helpers
- `stack/` — policies, peer identity, messages, crypto/utils
- `utils/` — shared helper utilities
- `specification/` — authoritative frame and transport contract notes

## 4) Transport behavior at a glance

- WebSocket entrypoint uses Fastify upgrade and reverse socket registry at `/ws`
- Socket.IO uses explicit handshake policy and shared message normalization
- Reverse/tunnel links keep external routeability for NAT/mobile topologies
- Network dispatch/fetch share the same canonical normalized frame shape

## 5) Routing sequence

1. normalize incoming payload (`to/target/targetId/deviceId`)
2. apply alias expansion (`networkAliases`)
3. resolve destination(s) and route intent
4. run endpoint policy checks
5. execute route (`local`, `upstream`, `both`, `auto`)
6. apply fanout and audit response shape

## 6) Upstream model

- **connector**: local endpoint that opens outbound reverse sessions (`mode=reverse`)
- **gateway/origin**: peer that accepts reverse sessions and forwards traffic onward

Default behavior is active reverse connector if `CWS_UPSTREAM_MODE` is unset (`active`).

Compat identity inputs include:

- `CWS_ASSOCIATED_ID` (maps to `deviceId`/`clientId`)
- `CWS_ASSOCIATED_TOKEN`
- legacy compatibility: `CWS_UPSTREAM_DEVICE_ID`, `CWS_UPSTREAM_CLIENT_ID`, `CWS_UPSTREAM_USER_ID`, `CWS_UPSTREAM_USER_KEY`

## 7) Special paths

- `POST /api/network/dispatch` handles command and event fanout across transport modes
- `POST /api/network/fetch` (plus compatibility route aliases) executes virtual requests over reverse peers
- `POST /api/network/topology` returns runtime node/link view for diagnostics and UIs
- `/ws` supports TCP passthrough events: `tcp.connect`, `tcp.send`, `tcp.close` with responses `tcp.connected`, `tcp.data`, `tcp.closed`, `tcp.error`

## 8) Compatibility posture

- canonical implementations are inside `network/*`
- `routing/*` and selected entrypoints are compatibility shells only
- when migrating existing deployments, keep aliases and compatibility fields (`AIRPAD_*`, `allowedOutcoming`) in place unless migration notes explicitly remove them
