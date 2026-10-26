# Authorization leases — source release 0.4.0

This is a source release candidate. npm publication is not claimed by this guide.

The v2 workflow gate preserves historical approval forever. A completed
checkpoint remains completed when its oracle changes. A lease gate serves a
different use case: temporary access to a bounded job queue, API capability or
agent resource that must still satisfy policy at the moment of each new use.

This feature records **job admission on GenLayer**. It does not execute an
external job, deliver an HTTP response, transfer tokens or operate escrow.

## Generate a lease gate

From the source checkout:

```sh
npm ci
npm run build
node examples/lease-contract.ts artifacts/lease-demo
node bin/gavel.mjs generate-leases reviewed-policy.json gate.py
node bin/gavel.mjs prepare-studio-next gate.py lease-deployment
```

The example uses placeholder subjects, controller and resource identity.
Replace them and review the resolver source before deploying. The generation
CLI refuses to overwrite an existing file. The source pins a concrete GenVM
runner and shares substantive oracle verification with the workflow generator.
The existing workflow source format and its monotonic semantics are unchanged.

```ts
import {generateLeaseContract, createLeaseClient} from 'gavel-judgment-sdk/leases';

const generated = generateLeaseContract({
  gateId: 'BUILD-ACCESS', controller: applicationController,
  oracles: [{
    id: 'LICENSE', contractAddress: reviewedResolver,
    expectedSpecHash: independentlyComputedSpecHash,
    marketId: 'LICENSE-CHECK', allowedOutcomes: ['PERMITTED'],
    minimumConfidenceBps: 9000, minimumSources: 1, maxAgeSeconds: 3600,
  }],
  capabilities: [{
    id: 'BUILD-JOBS', subject: agentWallet, resourceHash: reviewedResourceHash,
    oracles: ['LICENSE'], leaseSeconds: 300, maxUses: 3,
  }],
});
```

Limits: 16 capabilities, 8 unique resolver deployments, lease duration 30 seconds
to 24 hours and 1–1,000,000 total uses per capability. Every capability requires
at least one resolver; multiple resolvers use AND semantics. Policies, subjects,
resource hashes and the controller are compiled into immutable source. There is
no policy setter, oracle replacement or manual grant override.

## Lifecycle

1. **Open:** the configured subject calls `renew(capabilityId, 0)`. The gate reads
   the configured resolvers with `StorageType.LATEST_FINAL`, verifies their
   pinned specifications, outcomes, mandatory rules/features, confidence,
   evidence commitments, source coverage, exact quotes and observation age.
   A successful grant opens epoch 1.
2. **Use:** the subject calls `consume(capabilityId, epoch, requestId)`. A new use
   requires the current epoch, an unexpired/unrevoked grant, remaining budget
   and another successful read of every finalized resolver policy. It stores
   an immutable consumption receipt and increments the lifetime usage counter.
3. **Renew:** pass the last observed epoch. A successful refresh increments it
   atomically and links the previous grant hash. Old epochs cannot admit new
   requests. Concurrent stale renewals fail. **Renewal never resets maxUses or
   the request journal.** Exhausted capabilities cannot renew.
4. **Expire:** the expiry is exclusive. It is the earlier of the requested TTL
   and each grant observation's freshness deadline. At expiry, no new use is
   admitted. The subject may renew with fresh qualifying oracle observations.
5. **Revoke:** only the immutable controller can call `revoke(capabilityId,
   reasonHash)`. Revocation is permanent, including before the first grant.
   It records the reason commitment and time. It cannot fabricate a grant or
   redirect the subject/resource. Repeating the same revocation is idempotent;
   replacing its recorded reason is rejected.

An unavailable, unresolved, disallowed, stale or inconsistent oracle blocks new
use and renewal before state changes. It does not automatically write a permanent
revocation: a later valid observation may permit use again within the remaining
lease window. This is revalidation on use, not a background monitoring service.
Accepted-only oracle updates do not change the finalized view until finality.

## Requests and receipts

`requestId` must be a lowercase 32-byte hash. Applications should compute it from
the canonical job payload, resource and their own unique job nonce, then check
that exact commitment before dispatch. A resource hash alone does not validate
arbitrary job arguments. Receipts also bind chain ID, gate address, manifest,
capability, subject, epoch, grant hash, current oracle snapshots, time and usage
sequence. They cannot be substituted across deployments or capabilities.

A repeated request with its original epoch returns the exact stored receipt,
without another oracle read or budget decrement—even after expiry, renewal or
revocation. **That response acknowledges historical admission; it does not grant
fresh access.** Reusing the request with a different epoch fails. A worker must
deduplicate execution by the deployment/capability/request tuple and apply its
own maximum dispatch age. The SDK does not promise exactly-once external jobs.

```ts
const leases = createLeaseClient({
  reader: trustedGenLayerReader, chainId: 61997,
  contractAddress: reviewedGate, expectedManifest: generated.manifest,
});
const preview = await leases.preview('BUILD-JOBS'); // Advisory only.
const renewal = leases.renewRequest('BUILD-JOBS', observedEpoch);
const use = leases.consumeRequest('BUILD-JOBS', expectedEpoch, jobPayloadHash);
// App supplies the signer and current fee quote for these zero-value requests.
// Wait for successful finalized execution, not merely transaction acceptance.
const admitted = await leases.consumption('BUILD-JOBS', jobPayloadHash);
```

The client pins chain/deployment/manifest, reads `LATEST_FINAL`, obtains the
historical grant for the receipt's epoch, recomputes both hashes and verifies
time, resource, subject, quota and oracle policy. It sanitizes RPC exceptions.
It supplies no private key and signs no transaction.

## Portable audits

Export `{grant, consumption}` as a JSON bundle and audit it against the separately
reviewed manifest:

```sh
node bin/gavel.mjs audit-lease manifest.json bundle.json
```

`auditLeaseGrant` and `auditLeaseConsumption` return `integrity: VERIFIED` and
`finality: CLAIMED_ONLY`. Anyone can recompute JSON hashes. Offline results do
not authenticate chain history, prove current access or audit the full lifetime
usage journal. Authenticate receipts using the reviewed deployment and trusted
RPC; source review remains necessary because a malicious resolver can fabricate
a structurally valid verdict. A hash pin proves specification identity, not
the truthfulness or independence of its data publisher.

`leases.revocation(id)` reads and checks the finalized controller revocation;
`auditLeaseRevocation` checks a portable revocation record with the same explicit
`CLAIMED_ONLY` finality limitation.

## Reproduce verification

```sh
npm test
npm run test:lease-types
python -m pip install genlayer-test==0.29.2 genvm-linter==0.11.0
node examples/lease-contract.ts artifacts/lease-check
genvm-lint check artifacts/lease-check/gate.py
python -m pytest test/test_leases.py -v -s
```

Tests execute generated source and real storage, mocking cross-contract transport.
They cover oracle changes after grant, exact expiry boundaries, renewal races,
quota preservation, revocation, historical replay and Python-to-TypeScript
receipt audit parity. They do not establish public-network consensus or external
job execution. Public deployment evidence, if obtained, is recorded separately.
