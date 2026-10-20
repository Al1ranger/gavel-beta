# Milestone v2: onchain workflow gates

## Baseline

Accepted milestone v1 is commit `f028fdca975fdb0a9821a74676338cf1b315c224`
(0.2.0), which introduced backend callbacks and portable resolution audits.
This milestone adds a new generated contract and onchain state machine.

## New functionality

- Immutable dependency graphs with fixed actors, artifact hashes and oracle policies.
- AND composition of multiple categorical resolver contracts via cross-contract reads.
- Deterministic policy/dependency checks before any completion storage change.
- Hash-linked onchain completion receipts and idempotent replay.
- Finalized-state client reads, signer-owned write requests, generation/audit CLI.
- Offline audit of the full prerequisite receipt closure, explicitly not chain authentication.

## Verification

219 SDK tests pass (27 new); 90 direct contract tests pass (26 new).
The generated workflow and warranty resolver pass GenVM lint/validation.
Strict TypeScript consumer declarations compile; the packed source release
includes compiled workflow exports and the integration guide.

Live Studio Next verification finalized nine transactions with majority
agreement and leader-only mode disabled: two deployments, one new oracle
resolution, two checkpoint completions, three rejected calls and one replay.
The rejected calls exercise missing prerequisite, unauthorized actor and
not-yet-resolved oracle (VERDICT_NOT_AVAILABLE). Final progress is 2/2; replay
returned the same completion receipt and did not increase the count.

The gate's deployed source matches this generator exactly. LEGAL requires a
redistribution judgment; RELEASE requires LEGAL and both redistribution and
warranty-disclaimer judgments. The new warranty resolver deployment is reused
from the first integration attempt after source-hash verification.

## Submission title

Gavel SDK: onchain workflow gates and multi-oracle composition

## Changes & Improvements (890 / 1000 characters)

Added an onchain workflow engine that composes multiple Gavel resolvers into immutable approval checkpoints. Each checkpoint binds an actor, artifact hash, prerequisites and pinned oracle policies. The contract reads resolver state directly and rejects unauthorized callers, missing prerequisites, unresolved judgments, unsatisfied mandatory rules, stale evidence or disallowed outcomes before changing state. Successful completions store hash-linked receipts; replay returns the original receipt without advancing progress. New SDK clients, generation/audit CLI commands and dependency-chain audits support integration. This extends v1's backend callbacks with contract-enforced downstream state transitions. All 219 SDK and 90 contract tests pass, including 53 new cases. Live Studio Next verification completed two checkpoints, blocked three invalid calls and confirmed unchanged replay.

## Evidence

- [Delta from accepted v1](https://github.com/Al1ranger/gavel-beta/compare/f028fdc...main)
- [Live deployment, transaction results and receipts](deployments/workflow-gates-studio-next.json)
- [Pinned workflow manifest](deployments/workflow-gates-manifest.json)
- [Completion receipt chain](deployments/workflow-gates-completions.json)
- [Live gate](https://explorer-studio-dev.genlayer.com/address/0x0125160cc18E74E3F09f203c55697A0f19f60D78)
- [Successful downstream completion](https://explorer-studio-dev.genlayer.com/tx/0xe02ca5d81231bd683f33f620a8ca338500a6ba7eed67ef9ef51ecf4ca7908d50)
- [Replay](https://explorer-studio-dev.genlayer.com/tx/0x4ab5571fc5e149fc986ab42773d5f0f6ba833ac31d193715774e60661012f832)
- [Public integration guide](https://gavel-beta-sdk.vercel.app/docs/#workflow-gates)

## Reproduce

```bash
npm ci
npm test
pip install genlayer-test==0.29.2 genvm-linter==0.11.0
npm run test:contracts
node examples/workflow-contract.ts
genvm-lint check artifacts/workflow-demo/gate.py
node bin/gavel.mjs audit-workflow docs/deployments/workflow-gates-manifest.json docs/deployments/workflow-gates-completions.json
npm ci --prefix examples/live-resolution-action
node examples/live-resolution-action/verify-workflow.mjs
```

The generated example uses placeholder actor/artifact identities; replace them
before deployment. [API, trust boundary and live-demo instructions](WORKFLOW-GATES.md).

## Scope

The effect is a stored checkpoint authorization that becomes a prerequisite
for a subsequent onchain completion. No token transfer, software publication,
escrow payout or legal certification is claimed. The two license-fixture
resolvers share an immutable document; this is composition, not independent
source diversity. Completed checkpoints preserve historical approval and are
not revoked when an oracle later changes. New APIs are in the 0.3.0 source
release; no npm 0.3.0 publication is claimed.
