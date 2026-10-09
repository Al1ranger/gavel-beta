# Milestone v1: finalized resolution actions and portable audits

## Title

Gavel SDK: finalized resolution actions with durable replay protection

## Changes & Improvements

Added a new backend integration that turns finalized GenLayer categorical judgments into application-owned actions. The executor reads fresh finalized state and verifies chain/deployment identity, an independently pinned spec hash, a successful consensus resolve receipt, mandatory rules/features, confidence, approved evidence, exact supporting quotes and freshness before running a handler. New atomic memory/file journals prevent duplicate handlers across concurrent calls and process restarts; ambiguous failures remain reserved for reconciliation. Portable JSON audit bundles and a new CLI audit command expose evidence/spec commitments for review; offline checks explicitly do not authenticate finality. A live Studio Next test finalized a hash-pinned source judgment, released one local job, and blocked repeat execution. This adds a consequential backend integration beyond the prior generation/read APIs. 192 SDK tests pass, including 42 new cases.

## Reproduce from source

```bash
git clone https://github.com/Al1ranger/gavel-beta.git
cd gavel-beta
npm ci
npm run build
npm test
node examples/resolution-action.ts
node examples/resolution-action.ts
node bin/gavel.mjs audit-resolution artifacts/resolution-action-demo/bundle.json artifacts/resolution-action-demo/policy.json
```

The local example explicitly uses synthetic data. The first run releases one
local test job; the second returns ALREADY_COMPLETED with no additional writes.
The separate live evidence below uses a real finalized Studio Next judgment.

## Evidence

- [Integration API and trust model](RESOLUTION-ACTIONS.md)
- [Adversarial regression tests](../test/resolution.test.ts)
- [Live test manifest](deployments/resolution-actions-studio-next.json)
- [Live audit bundle](deployments/resolution-actions-bundle.json)
- [Finalized resolve transaction](https://explorer-studio-dev.genlayer.com/tx/0xa5d8d3def5619a68c8744f6f452e0da65b910a97f9ba68286986c3617bab52dc)
- [Live contract](https://explorer-studio-dev.genlayer.com/address/0xf91789141312A8fE22c50489E2aaFd0af645F2E7)

## Scope and baseline

The source delta is against SDK 0.1.4. The source package version is 0.2.0;
the registry remains 0.1.4 until a separate publish succeeds. The portal's last
accepted submission determines the steward's milestone baseline. This submission
claims new action/audit functionality, not the previously shipped mandatory-rule
fix, renaming, restyling, or the previous contract deployments.
