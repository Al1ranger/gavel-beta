# Finalized resolution actions

New integration entry point: `gavel-judgment-sdk/resolution` (0.2.0).

The generator decides an outcome. This module lets a consuming backend turn that
outcome into a consequential action without treating an unfinalized or invalid
result as authorization. It adds portable evidence audit bundles and a durable
reservation protocol for downstream work.

## What changed since 0.1.4

Previously, `createOracleClient` returned finalized state and a submitted write
hash. Applications had to implement evidence commitment verification, consumer
policy, receipt binding and replay protection themselves. The new executor does
those checks before calling an application-owned action handler.

It supports **generated categorical resolvers**. Scalar observations and odds
journals remain observation APIs and are not authorized as resolved actions.

## Connect a backend

```ts
import {
  createResolutionExecutor, createFileActionStore,
  type ResolutionReader, type ResolutionPolicy,
} from 'gavel-judgment-sdk/resolution';

// Your configured GenLayer client implements the reader interface. Studio Next
// requires a compatible 2.x client. Signing stays in your own application.
const executor = createResolutionExecutor({
  reader: genlayerClient as ResolutionReader,
  store: createFileActionStore('./data/resolution-actions'),
});
const policy: ResolutionPolicy = {
  chainId: 61997,
  contractAddress: deployedAddress,
  expectedSpecHash: independentlyVerifiedSpecHash,
  minimumConfidenceBps: 9000,
  minimumSources: 1,
  maxAgeSeconds: 3600,
  now: Math.floor(Date.now() / 1000),
  allowedOutcomes: ['VERIFIED'],
};
const result = await executor.execute({
  policy,
  transactionHash: finalizedResolveTransaction,
  action: { name: 'release-delivery', input: { jobId: 'job-42' } },
  apply: async ({ key, input }) => {
    // Your service must also use key as its idempotency key.
    await jobs.release(String(input.jobId), { idempotencyKey: key });
    return `job:${input.jobId}:released`;
  },
});
// COMPLETED or ALREADY_COMPLETED; the latter does not call apply again.
console.log(result.status, result.receipt, result.bundle.bundleHash);
```

The independently pinned spec hash must come from the deployment you reviewed,
not from the uploaded result being checked. `resolutionDigest(compiledSpec)`
computes the hash for integer-valued JSON specs from the generator.

## Checks before any downstream action

- RPC chain, deployment address, expected specification hash and market identity.
- FINALIZED, FINISHED_WITH_RETURN, MAJORITY_AGREE, consensus mode and a successful
  leader receipt for a zero-argument `resolve` call at that contract.
- RESOLVED, registered winner index/outcome, application-allowed outcome.
- Confidence at least the application's and contract's configured thresholds.
- Every declared mandatory rule and required feature satisfied; no conflicts.
- Exact approved evidence source coverage and recomputed SHA-256 commitment.
- Minimum available sources and an exact supporting quote for the winner.
- Observation after the resolution time, within the application's age limit,
  and never in the future.

The generated categorical resolver stops after RESOLVED. The executor refuses
UNRESOLVED, which remains retryable, so a later unresolved attempt cannot be used
to authorize an action with an unrelated receipt.

## Portable audit bundles

`readResolutionBundle(reader, policy, txHash)` obtains fresh finalized state and
returns a versioned JSON export containing spec, verdict, normalized receipt,
deployment identity and a SHA-256 bundle commitment. Store it beside your action
receipt for independent review.

```bash
node examples/resolution-action.ts
node bin/gavel.mjs audit-resolution \
  artifacts/resolution-action-demo/bundle.json \
  artifacts/resolution-action-demo/policy.json
```

The local example uses an **explicitly synthetic reader** and releases a local
test job file. It is reproducible without a wallet. Running it twice preserves
the reservation journal and returns ALREADY_COMPLETED.

Offline audit reports `finality: CLAIMED_ONLY`. Integrity hashes detect changed
content; they do not authenticate an RPC, prove source truth, or provide a
cross-chain proof. An attacker can construct a self-consistent export. **Only
fresh reads from the application's trusted RPC authorize execution.**

## Reservations, retries and failures

The action key binds chain, contract, market and action name. Its payload hash
binds the spec hash, accepted outcome, evidence digest and application input.
Changing the input for an existing key returns ACTION_CONFLICT. Concurrent
workers sharing the store cannot both invoke the handler.

The file store atomically reserves with exclusive file creation, syncs the
reservation before the handler runs, and atomically replaces it with a synced
completion record. It survives process restart on a local filesystem. For
multiple hosts, implement `ResolutionActionStore` with a database unique key
and atomic reservation; do not use the file store on NFS. The memory store is
for tests or one process and does not survive restart.

A crash, ambiguous handler failure, invalid handler receipt or completion-write
failure leaves RESERVED and returns ACTION_RECONCILIATION_REQUIRED. **No
automatic retry is permitted.** Inspect the downstream system using the action
key before deciding whether to complete or recover its reservation. This favors
duplicate prevention over automatic recovery; it is not an exactly-once
distributed transaction.

## Current limits

- Node.js backend integration; it does not sign transactions or transfer tokens.
- The example's local job release is not an onchain escrow payment.
- Specs and exports require safe JSON integers. Fractional, unsafe or negative
  zero numbers are rejected to avoid Python/JavaScript hash ambiguity. Numeric
  observations should be scaled integers or strings in this integration.
- The pinned RPC and configured deployment remain trust assumptions. Studio
  state can reset. Use a reviewed deployment and reliable RPC for real consumers.
- The file store covers process restarts, not power-loss guarantees or manual
  journal deletion. Production services should use a durable database store and
  downstream idempotency keys appropriate to their recovery requirements.
- A successfully executed historical resolve receipt is checked alongside the
  terminal finalized state; the export is not a cryptographic receipt-to-state
  inclusion proof.

## Live integration evidence

On October 8, 2026 (Pacific time), the generated license-permission fixture on
Studio Next chain 61997 finalized RESOLVED / PERMITTED with FINISHED_WITH_RETURN.
The contract acquired an immutable OpenZeppelin document, checked its pinned
SHA-256 bytes, and evaluated the declared rules through consensus. The new
executor then released one local job and refused duplicate execution. Recreating
the file store and rerunning the live reader also produced zero additional
writes. [Manifest and transaction identities](deployments/resolution-actions-studio-next.json).

The license fixture is an integration test, not a complete legal/compliance
assessment. No payment, escrow settlement or token transfer occurred. A separate
attempt against the existing public-delivery resolver failed with an unsupported
model quote; its action was rejected rather than weakening quote verification.

To verify the existing live deployment without signing or submitting a transaction:

```bash
npm run build
npm --prefix examples/live-resolution-action install
npm --prefix examples/live-resolution-action run verify
npm --prefix examples/live-resolution-action run verify
```

This isolated example installs a compatible Studio Next reader, verifies the
onchain source hash, and uses a local action journal. It permits a one-year
observation age only for the immutable hash-pinned license fixture; use a shorter
application-specific limit for changing facts. The network may reset, in which
case live verification fails closed. Historical bundle inspection remains possible:

```bash
node bin/gavel.mjs audit-resolution docs/deployments/resolution-actions-bundle.json docs/deployments/resolution-actions-policy.json
```

The exported policy's `now` is the original verification timestamp. This offline
command replays that historical policy check and never authorizes a current action.
