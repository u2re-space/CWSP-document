# Network Stack Internals

`network/stack/*` is the canonical implementation layer for message handling and topology decisions.

## Responsibilities

- protocol message normalization support (`messages.ts`)
- endpoint policy parsing and route checks (`endpoint-policy.ts`)
- transport topology helpers and route planning (`topology.ts`)
- peer identity helpers and token normalization (`peer-identity.ts`)
- HTTPS and transport bootstrap helpers (`https.ts`)
- crypto and utility helpers (`crypto-utils.ts`)
- shared protocol schema (`protocol.ts` and `protocol/index.ts`)

The stack is intentionally free of direct framework-specific transport orchestration:

- Socket transport details live in `network/socket/*`
- Tunnel/reverse details live in `network/tunnel/*`
- HTTP entrypoints remain in `network/http/*`

## Current architecture intent

- one policy format for all protocols
- route decision is centralized and reusable from all surfaces
- explicit fallback chains for compatibility and migration

## Topology and route intent

- route candidates are resolved with consistent policy + alias logic before transport write
- fanout works through explicit `targets`, fallback broadcast settings, and compatibility behavior
- upstream availability is considered for `auto` route selection

## Planned / watch list

- continue improving role visibility in topology (`node`, `peer`, `gateway`)
- strengthen local/private/NAT decision paths
- keep compatibility fields as stable compatibility shims until all migration points are completed
