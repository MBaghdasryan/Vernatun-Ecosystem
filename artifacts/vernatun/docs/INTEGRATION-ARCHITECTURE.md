# Integration architecture — current state and boundaries

## Existing implementation

Email uses a common provider contract and independent Resend, SMTP and development
outbox adapters. Acceptance is separate from delivery evidence. Signed Resend
webhooks and idempotent receipt processing remain the existing implementation.
No email provider test is performed by the System health screen.

Private file storage already separates local, S3-compatible and App Storage
providers from authorized application file access. Its storage identity must
not become a public download URL or expose a credential/path in System metrics.

## Not implemented in this increment

Generic integration registry, per-organization provider instances, capability
schemas, connection-test jobs, encryption/key rotation for persisted integration
credentials, general outbound webhooks and scoped API client keys.

Future payment/bank integration work here is architecture only. Do not introduce
a gateway, bank connection or external provider without the separate approved
scope. Existing manual statements and financial business rules stay unchanged.

## Secret boundary

Runtime secrets remain in the existing managed secret configuration.
`environment.read` must never grant secret values. The operational log schema
does not accept arbitrary provider response bodies. Any future provider error
adapter must emit reviewed metadata, not copy its raw exception into logs.
No browser-side credentials or a plaintext secret management API are created.
