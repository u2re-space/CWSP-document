# Socket Transport Layer

This layer implements real transport IO for both Socket.IO and raw WebSocket links.

## Layer split

- `websocket.ts` — Fastify upgrade lifecycle, connection registry, reverse socket entries
- `socketio-bridge.ts` — Socket.IO lifecycle and bridge behavior
- `socketio-security.ts` — handshake validation, CORS, and allowRequest policy
- `routing/*` — protocol normalization + shared routing hooks used by socket transports

## Responsibility boundaries

Transport modules should only:

- manage connection lifecycle and backpressure/cleanup
- pass validated frames to canonical routing helpers
- apply transport-specific transport limits and events

They should not encode business routing semantics beyond transport boundaries.

## Reverse transport semantics

A reverse WebSocket connection (`mode=reverse`) registers a reverse-capable device for upstream tunnel operations and fanout.
A reverse WebSocket connection (`mode=reverse`) is now documented as `responser-initiator` ↔ `requestor-initiated` role pairing.

### TCP passthrough on WebSocket

`websocket.ts` supports forwarding raw TCP-like stream control over WS:

- `tcp.connect` — opens outgoing stream target
- `tcp.send` — sends payload chunk (base64 encoded)
- `tcp.close` — closes stream

Responses include:

- `tcp.connected`
- `tcp.data`
- `tcp.closed`
- `tcp.error`

## Security and filtering

Destination filtering is available through environment-driven allow-lists when passthrough and tunneling are enabled.

Common keys:

- `WS_TCP_ALLOW_ALL`
- `WS_TCP_ALLOW_HOSTS`
- `WS_TCP_ALLOWED_HOSTS_WITH_PORT`

## Compatibility

Message normalization and dispatch behavior are centralized in `network/socket/routing/*`, while this folder exposes transport-facing behavior.
