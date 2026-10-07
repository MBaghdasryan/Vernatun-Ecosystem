# Operations encryption readiness

The cryptographic foundation is implemented and tested. On 2026-10-07 the
development key passed application validation and an authenticated roundtrip.
A configuration backup was written to private App Storage and verified after
read-back. This does not demonstrate full-data recovery or an integration vault.

## Configuration

`VERNATUN_OPERATIONS_ENCRYPTION_KEY` must contain 32 cryptographically random bytes
encoded as exactly 64 hexadecimal characters. Supply it through Replit Secrets,
never chat, a source file, the application database or an uploaded backup.
Do not use a password, SESSION_SECRET or a third-party API key for this value.

Keep a protected independent recovery copy. Losing this key would make data
encrypted with it unrecoverable. Do not replace or rotate it blindly: the current
foundation rejects ciphertext carrying an unknown key identifier. A managed
key-ring/rotation workflow is not implemented yet.

## Format and boundaries

- AES-256-GCM, random 96-bit nonce, 128-bit authentication tag.
- Per-purpose derived key using HKDF-SHA256; authenticated context includes
  domain and record identity. A future caller must include organization/provider
  identity for integration records, and the snapshot ID for backup records.
- The envelope includes version, algorithm, non-secret key identifier, nonce,
  tag and ciphertext. It does not include a password or decryption key.
- Fixed schema validation rejects unknown envelope fields, invalid encodings,
  tampering and a mismatched key or context.
- Environment UI shows only configured/not configured.

## Still to complete

Backup storage adapters and queued snapshot creation/verification now consume
this foundation. Development configuration is verified; other environments must
be checked separately. With a missing/invalid key creation is disabled rather
than falling back to plaintext. Isolated tests use
an ephemeral test key and a separate local storage directory, never the working
key or production data.

The full restore flow, integration secret-vault CRUD and key-ring
rotation remain incomplete. No successful recovery rehearsal of the new
encrypted package format is claimed.
