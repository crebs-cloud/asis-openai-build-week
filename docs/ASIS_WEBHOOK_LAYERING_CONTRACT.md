# Asis webhook layering contract

Artifact type: `contract`

The public handler composes event ingestion, routing, policy, application
service, and integration adapters. Each layer is independently testable and
must return normalized values without raw provider credentials or private
request bodies.

Supported application actions are `ignored`, `invalid_inbound`,
`duplicate_inbound`, `idempotency_unavailable`, `policy_response`, and
`inbound_message`.
