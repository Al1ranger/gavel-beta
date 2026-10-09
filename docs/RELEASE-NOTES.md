# Release notes

## 0.2.0 — resolution actions

- New `gavel-judgment-sdk/resolution` entry point: verified finalized resolution
  acquisition, independently pinned spec policy and downstream action execution.
- Recompute Python-compatible evidence and specification commitments; validate
  mandatory rules/features, confidence, source availability, quotes and freshness.
- Bind successful finalized consensus receipts to the categorical resolver call.
- Export versioned audit bundles and audit them with `gavel audit-resolution`.
  Offline checks explicitly do not authenticate chain finality.
- Memory and durable local-file action stores reserve before the callback;
  concurrent/replayed consumers cannot repeat a completed action. Interrupted
  outcomes require downstream reconciliation and never automatically retry.
- New reproducible job-release integration example, API guide and adversarial
  regression tests. No private keys or token transfers are added to the SDK.
- Verification: 192 SDK tests pass (42 new). Live consensus released one local
  job; replay/restart performed zero additional writes. A failed live judgment
  made zero reservations and zero writes. Provider errors are sanitized.

## 0.1.4

- Generated categorical resolvers deterministically return UNRESOLVED when any
  declared mandatory resolution rule is marked unsatisfied. Validator acceptance
  rejects a RESOLVED candidate even when both model answers agree on the false rule.
- Regression tests exercise each rule through leader finalization, canonical
  UNRESOLVED acceptance, and invalid RESOLVED candidate rejection.
- Verification: all four new regression cases fail before the fix and pass after
  it; 150 SDK tests, 64 direct contract tests, and four generated-contract lint
  checks pass.
- Upgrade to 0.1.4, regenerate, and redeploy to adopt the fix. The reference
  earthquake and public-delivery resolvers were replaced on chain 61997; both
  finalized successfully and their on-chain source matches the patched generator.
  Old deployment addresses are immutable and retain their previous code.

## 0.1.3 — published

- Expanded deployment proof, troubleshooting and site documentation.
- Generated source headers and the public-delivery recipe now reference gavel-judgment-sdk.

## 0.1.2 — published

- Public entry points compile under strict TypeScript without skipLibCheck.
- Public-import tests use gavel-judgment-sdk.
- npm archive includes the real-world judgment and historical deployment guides. The newest deployment proof and expanded guide are available in this repository.
- Deployment preparation identifies missing files and existing directories, and accepts Windows CRLF headers.
- Local-install commands use npx gavel.
- 150 tests pass; clean-consumer imports, contract generation, CLI and strict declarations verified.
- Studio Next earthquake contract finalized successfully; get_progress read verified. Judgment resolution remains unexecuted.

See [Studio Next guide](STUDIO-NEXT.md) for the contract, transaction and verification commands.

## 0.1.1 — published

Initial gavel-judgment-sdk npm release.
