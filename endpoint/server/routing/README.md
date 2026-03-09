# Routing Compatibility Layer

`routing/*` remains a compatibility entry layer after migration of endpoint networking to `network/*`.

## Purpose

- preserve historical import paths used by older endpoint modules
- delegate real implementation to canonical `network/*` exports
- avoid behavior changes while allowing incremental migration

## Canonical implementation location

- `network/http/` for HTTP behavior
- `network/socket/` for socket/WebSocket behavior
- `network/tunnel/` for upstream and reverse-link logic
- `network/protocol/` and `network/stack/` for shared contracts/helpers

## Guidance for edits

For new protocol or routing work:

- use `network/socket/routing/*` for frame normalization and policy checks
- keep transport-specific files limited to connection and I/O mechanics
- prefer canonical types from `network/protocol/protocol.ts`
