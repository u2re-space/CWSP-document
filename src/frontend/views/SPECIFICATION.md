# CrossWord Views Spec

## Scope

Views are canonical consumers of routed app messages.

Examples:

- `viewer`
- `workcenter`
- `explorer`
- `settings`
- `history`
- `editor`
- `print`

## Receive Contract

Views receive normalized `UnifiedMessage` deliveries through `bindViewReceiveChannel(...)`.

That binding must handle:

- direct unified message delivery
- queued pending messages
- `rs-view-*` transport fan-out for `view-transfer`
- `view-post` payloads forwarded through the same receive lifecycle

## Naming Rule

View ids are canonical (`viewer`, `explorer`, `workcenter`, ...). Legacy ids such as `markdown-viewer` and `file-explorer` remain compatibility aliases only.

## Routing Rule

Views should not directly depend on transport names. They react to:

- canonical destination id
- normalized message type
- message data and metadata

## Ingress Rule

Share target and launch queue must reach views through `ViewTransferRouting.ts`, not through view-specific one-off cache polling or ad-hoc `BroadcastChannel` names.
