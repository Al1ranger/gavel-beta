# Onchain workflow gates

## What this adds

The accepted 0.2.0 milestone ran an application callback after reading a finalized
judgment. Version 0.3.0 adds a new onchain contract type: a workflow graph whose
checkpoint writes are authorized by other intelligent contracts. The stored
completion of one checkpoint becomes a deterministic prerequisite for another.
An application can use it for multi-stage evidence review, artifact approval or
release authorization without trusting a caller's submitted verdict.

This registry records approval of a fixed artifact hash. It does not execute a
software release, certify legal compliance, transfer tokens or operate escrow.

## Generate and deploy

Install the SDK and generate a contract from your reviewed workflow manifest:

```bash
npm install gavel-judgment-sdk@0.3.0
npx gavel generate-workflow manifest.json gate.py
```

The package exports `gavel-judgment-sdk/workflow` and includes the
`generate-workflow` and `audit-workflow` CLI commands. To reproduce the source example:

```bash
git clone https://github.com/Al1ranger/gavel-beta.git
cd gavel-beta
npm ci
npm run build
node examples/workflow-contract.ts
```

The example writes `artifacts/workflow-demo/{gate.py,manifest.json}`. It uses
example actors and artifact hashes: replace them before deployment. Configuration
is compiled into the source, with a concrete GenVM runner pin. There is no admin
policy setter, oracle replacement or checkpoint override.

```ts
import { generateWorkflowContract } from 'gavel-judgment-sdk/workflow';
const generated = generateWorkflowContract({
  workflowId: 'DOCUMENT-RELEASE',
  oracles: [{
    id: 'LICENSE', contractAddress: reviewedOracleAddress,
    expectedSpecHash: independentlyComputedSpecHash,
    marketId: 'LICENSE-PERMISSION', allowedOutcomes: ['PERMITTED'],
    minimumConfidenceBps: 9000, minimumSources: 1, maxAgeSeconds: 3600,
  }],
  checkpoints: [
    {id: 'LEGAL', actor: reviewerAddress, artifactHash,
     requires: [], oracles: ['LICENSE']},
    {id: 'RELEASE', actor: publisherAddress, artifactHash,
     requires: ['LEGAL'], oracles: ['LICENSE']},
  ],
});
```

The generator rejects cycles, missing/self dependencies, duplicate checkpoints,
duplicate oracle addresses, unknown/unused oracles, malformed identities and
unbounded policies. Limits: 16 checkpoints, 8 distinct oracle contracts, 16
allowed outcomes per oracle; checkpoint IDs and outcome IDs use uppercase ASCII.
Configuration order is normalized before hashing. Every checkpoint needs at
least one oracle. Multiple oracle checks use AND semantics.

```bash
node bin/gavel.mjs generate-workflow manifest.json gate.py
node bin/gavel.mjs prepare-studio-next gate.py new-deployment
```

Generation refuses to overwrite an existing output. Use the
[Studio Next deployment guide](STUDIO-NEXT.md) with an application-owned signer.
Estimate current protocol fees: an EVM gas price of zero does not imply zero
GenLayer protocol fees. Preview is advisory; submit `complete` and wait for
finalized successful execution before treating a checkpoint as completed.

## Read and submit

```ts
import {createWorkflowClient, auditWorkflowChain} from 'gavel-judgment-sdk/workflow';
const workflow = createWorkflowClient({
  reader: trustedGenLayerClient, chainId: 61997,
  contractAddress: reviewedGateAddress, expectedManifest: generated.manifest,
});
const preview = await workflow.preview('RELEASE');
// READY, BLOCKED with dependency/oracle IDs, or COMPLETED with a receipt.
const request = workflow.completeRequest('RELEASE');
// App supplies signer, fee quote and finality tracking. Request value is 0n.
const transactionHash = await signingClient.writeContract({...request, fees});
await signingClient.waitForTransactionReceipt({hash: transactionHash,
  waitUntil: 'finalized', fullTransaction: true});
const receipt = (await workflow.completion('RELEASE')).value;
```

`completion` reads `LATEST_FINAL`, verifies the deployed manifest against the
independently supplied manifest, and checks the returned receipt's identity,
hash, actor, artifact and oracle policy. It does not submit or sign transactions.
Always check both transaction finality and successful execution yourself.

## Contract checks and state transitions

`complete(checkpoint_id)` rejects a wrong actor before reading oracles. Missing
prerequisite completions block the call. Each configured contract is called via
`gl.get_contract_at(address).view().get_spec()` and `get_verdict()`; callers cannot
provide alternate evidence or override the expected outcome. It checks:

- Actual specification hash and market ID against the baked-in oracle policy.
- RESOLVED, valid winner/index, allowed outcome, valid attempt and confidence.
- Every mandatory resolution rule covered exactly once and satisfied `True`.
- Required features satisfied, no duplicate/foreign feature attestations, no conflicts.
- Evidence source coverage, availability, SHA-256 commitment and exact supporting quote.
- Observation time, resolution time, freshness and no future-dated verdict.

All checks run before any storage change. Success stores the actor, fixed artifact
hash, completion time/sequence, oracle snapshots and prerequisite receipt hashes.
A receipt hash commits to the complete record. Repeating a completed checkpoint
as its assigned actor returns the same receipt without reading oracles or
incrementing the count. Historical completion persists if its oracle later
changes or becomes stale; it records the approval at completion time. This is
deliberate monotonic workflow state, not continuous revalidation.

Oracle reads follow GenLayer's current-block cross-contract dependency semantics;
they are not an independent proof of the source transaction's finality. The
application waits for the gate transaction to finalize. Use independently
reviewed immutable resolver addresses and inspect source code before pinning
their specifications. A malicious contract can fabricate a well-formed verdict.
Two oracle addresses do not imply independent data or independent trust.

## Receipt-chain audit

```bash
node bin/gavel.mjs audit-workflow manifest.json completions.json
```

`completions.json` is an array containing each included checkpoint and its full
dependency closure. `auditWorkflowChain` checks each receipt against the manifest,
unique checkpoint IDs/sequences, prerequisite hash links, increasing sequence
and nondecreasing time. It rejects missing prerequisites. It does not require
unrelated checkpoints to be included.

Offline results say `integrity: VERIFIED, finality: CLAIMED_ONLY`. Anyone can
recompute a JSON hash; these files are not signatures or chain proofs. Authenticate
the recorded completions using a trusted RPC and the reviewed gate deployment.

## Live Studio Next demo

The explicit write demo uses new memory-only signers and the public Studio faucet.
It sends no user funds and refuses protocol fee quotes above 0.11 test GEN per
transaction. The output journal saves each hash before polling; polling errors
retry the same transaction. If the process exits, keys are discarded: do not
blindly rerun to resume an incomplete workflow. Inspect saved transactions first;
a new run creates new actors/contracts. This is a disposable test integration,
not a production key-management workflow.

```bash
npm ci --prefix examples/live-resolution-action
node examples/live-resolution-action/workflow.mjs artifacts/workflow-live
```

It combines the v1 hash-pinned OpenZeppelin redistribution resolver with a new
warranty-disclaimer resolver. Both inspect the same immutable LICENSE document;
this demonstrates composition, not diverse source independence. A LEGAL checkpoint
requires redistribution permission; RELEASE requires LEGAL and both oracle
policies. The artifact hash identifies the license fixture, not a released SDK.
One-year age is allowed only for this immutable license archive; the new warranty
observation has a one-hour policy.

The demo tests missing prerequisite, unauthorized actor, unresolved oracle,
successful completions and unchanged replay. See [milestone evidence](MILESTONE-V2.md).

Read-only verification of the committed deployment:

```bash
npm ci --prefix examples/live-resolution-action
node examples/live-resolution-action/verify-workflow.mjs
node bin/gavel.mjs audit-workflow docs/deployments/workflow-gates-manifest.json docs/deployments/workflow-gates-completions.json
```

The verifier reads both resolver sources, checks the gate source against this
generator, compares onchain completions with the recorded receipts, verifies
all nine finalized transactions and exact rejection codes, and checks progress
remains 2/2. It supplies no signer and sends no transaction.

## Local verification

```bash
npm test
pip install genlayer-test==0.29.2 genvm-linter==0.11.0
python -m pytest test/test_oracles.py test/test_workflow.py -q -s -p no:cacheprovider
```

Contract tests execute generated Python and real storage with mocked
cross-contract transport. They test policy rejection and atomic state; they do
not establish consensus. The test harness pins archive v0.2.16, which contains
the exact runner hash declared by the generated contracts. Live transaction
evidence is recorded separately.
