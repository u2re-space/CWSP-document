# CrossWord Shells Spec

## Scope

Shells own navigation, layout, and view mounting. They are not a second messaging protocol.

## Responsibilities

- mount canonical views by canonical view id
- bind view receive channels once per loaded view
- react to canonical destination ids when deciding which view to show
- keep compatibility aliases only at the boundary where older routes or hash names still exist

## Messaging Rule

Shell code may mirror through `BroadcastChannel` for compatibility, but canonical delivery still flows through unified messaging and the shared view receive binding.

## Navigation Rule

- destination id decides the target consumer
- route path or hash is a shell concern
- shell navigation must not rewrite the logical destination semantics

## Compatibility Guardrail

If a shell still exposes legacy hash names such as `#markdown-viewer`, it must map them back to canonical ids before dispatching or binding handlers.
