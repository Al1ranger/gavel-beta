# Release notes

## Unreleased

- Generated categorical resolvers deterministically return UNRESOLVED when any
  declared mandatory resolution rule is marked unsatisfied. Validator acceptance
  rejects a RESOLVED candidate even when both model answers agree on the false rule.
- Regression tests exercise each rule through leader finalization, canonical
  UNRESOLVED acceptance, and invalid RESOLVED candidate rejection.
- Verification: all four new regression cases fail before the fix and pass after
  it; 150 SDK tests, 64 direct contract tests, and four generated-contract lint
  checks pass.
- Regenerate and redeploy existing contracts to adopt the fix; deployed contract
  code and the published 0.1.3 npm package are unchanged.

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
