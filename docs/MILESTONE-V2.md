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

Live verification is in progress. A final evidence manifest will record only
observed finalized transactions, source hashes and completion receipts.

## Reproduce

```bash
npm ci
npm test
pip install genlayer-test==0.29.2 genvm-linter==0.11.0
npm run test:contracts
node examples/workflow-contract.ts
genvm-lint check artifacts/workflow-demo/gate.py
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
