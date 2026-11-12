# Milestone v3: expiring, revocable authorization leases

## Baseline and new work

Baseline: published SDK 0.3.0 at
[`02e8e507`](https://github.com/Al1ranger/gavel-beta/commit/02e8e507b77c5cc82a02fa1bfb4009def56f5fc5).
Milestone v2 added immutable workflow checkpoints with persistent completion.
This milestone adds a separate generated contract, lease state machine and SDK
entry point for bounded access that must remain supported by current evidence.

| Capability | v2 workflow | v3 authorization leases |
| --- | --- | --- |
| Stored effect | Historical checkpoint approval | Time-limited job admission |
| Oracle check | At first completion | At opening, renewal and every new use |
| Oracle read mode | Current-block dependency | Explicit LATEST_FINAL |
| Time policy | Freshness at completion | Lease expiry capped by source observations |
| Renewal | No lease epoch | Atomic expected-epoch renewal |
| Usage limit | One completion per checkpoint | Fixed lifetime budget per capability |
| Revocation | Completions remain historical | Permanent controller revocation |
| Replay | Original checkpoint receipt | Original consumption receipt, no new access |

The old workflow generator's output remains byte-identical to its published
deployment. New lease contracts reuse its substantive oracle verification rules.
This is new contract functionality; it does not rename or restyle prior work.

## Review path

1. Follow [AUTHORIZATION-LEASES.md](AUTHORIZATION-LEASES.md) to generate a gate
   from a policy with a subject, resource commitment, controller, lifetime quota,
   lease TTL and reviewed resolver policies.
2. Review [the contract runtime](../src/leaseRuntime.ts). `renew` and `consume`
   read finalized resolvers; all checks finish before storing grants or uses.
   Renewal preserves spent quota and request history. `revoke` cannot issue
   access or edit the immutable policy.
3. Review [the public API](../src/leases.ts). It exports generation, normalized
   policy, finalized-state reads, unsigned requests and portable grant,
   consumption and revocation audits.
4. Run the contract cases. They execute generated Python and actual storage
   with mocked cross-contract transport. After a grant, change an oracle's
   verdict/rule/evidence and verify a new use fails without consuming budget.
   Verify expiry boundaries, revocation, renewal races and request replay.
5. Run the SDK cases and CLI audit. One contract test exports real Python
   receipts and checks them using the public TypeScript CLI, establishing
   canonical hash/policy parity across the two implementations.

```sh
npm ci
npm test
npm run test:lease-types
python -m pip install genlayer-test==0.29.2 genvm-linter==0.11.0
node examples/lease-contract.ts artifacts/lease-check
genvm-lint check artifacts/lease-check/gate.py
npm run test:contracts
```

## Verification

- **260 SDK tests pass**, including 41 new lease cases.
- **133 contract tests pass**, including 43 new lease cases.
- Generated lease source passes GenVM AST lint and semantic/schema validation.
- Public root/subpath declarations compile with strict TypeScript and
  `skipLibCheck=false` using the documented structural reader interface.
- The lease SDK checksums deployment addresses for Studio Next RPC calls while
  preserving canonical lowercase addresses in receipts and digests.
- Package checks include compiled lease exports, declarations, runtime and guide.
- The generated source of the existing published workflow still hashes to
  `6ae39c6eed0447b2c532dc69f22a002982b5565f2b89485a770da1685811bee2`.
- [Machine-readable verification report](verification/authorization-leases.json).

## Studio Next verification

The [deployed lease gate](https://explorer-studio-dev.genlayer.com/address/0x94E0C78A432Ac2E8BB8476305380EFDEF59aa382)
on chain 61997 matched the generated source byte for byte. Seven transactions
finalized with majority agreement. The gate opened against the finalized
license resolver, admitted one request, and carried the spent use into epoch 2.
After controller revocation, replay preserved the original receipt and a fresh
request reverted with `LEASE_REVOKED`. Finalized state showed one use and
`REVOKED`. [Deployment proof and receipts](deployments/authorization-leases-studio-next.json).

To rerun the public testnet demo from the repository root:

```sh
npm ci
npm run build
npm ci --prefix examples/live-resolution-action
node examples/live-resolution-action/verify-leases.mjs
```

The demo uses fresh in-memory signers and Studio faucet funds. It requires the
committed license resolver to be available within the configured 90-day
observation window. It records the submitted hashes under `artifacts/` before
polling. If interrupted, inspect those hashes before sending another transaction.

## Scope

Source candidate version: **0.4.0**. npm publication is not claimed. The current
README installation command continues to point at the existing npm 0.3.0 release.

The contract records admission of one payload commitment to one resource. The
Studio demo exercises contract state with test GEN and performs no external job.
Applications must bind the request hash to actual job arguments and deduplicate
external execution. Historical replay acknowledges an earlier admission even
after expiry/revocation; it does not grant current access. Offline hashes return
`finality: CLAIMED_ONLY` and require independent RPC/deployment authentication.
The immutable controller can permanently deny a capability but cannot override
an oracle or create a passing grant. Resolver data independence is not implied
by multiple configured addresses.

## Submission title

Gavel SDK: expiring, revocable authorization leases

## Changes & Improvements (825 / 1000 characters)

Built a GenLayer authorization gate for time-limited agent and job access. Each capability binds a subject, resource hash, lifetime quota and oracle policy. Opening, renewal and every new use recheck finalized judgments, mandatory rules, confidence, evidence and freshness. Renewal preserves spent quota, and controller revocation blocks new uses. Added a contract generator, finalized-state SDK client, unsigned requests and a CLI for portable receipt audits. On Studio Next (61997), seven transactions finalized with majority agreement. The gate admitted one request, renewed without restoring quota, preserved the historical receipt on replay and rejected a fresh request after revocation. Published the contract, transaction hashes and reproducible demo in the project repository. All 260 SDK and 133 contract tests pass.

## Evidence

- [Delta from v2](https://github.com/Al1ranger/gavel-beta/compare/02e8e50...main)
- [Studio Next deployment proof](deployments/authorization-leases-studio-next.json)
- [Lease generator and public API](https://github.com/Al1ranger/gavel-beta/blob/main/src/leases.ts)
- [Contract state machine](https://github.com/Al1ranger/gavel-beta/blob/main/src/leaseRuntime.ts)
- [Contract regressions](https://github.com/Al1ranger/gavel-beta/blob/main/test/test_leases.py)
- [Verification report](https://github.com/Al1ranger/gavel-beta/blob/main/docs/verification/authorization-leases.json)

This is copy-ready draft text. No Project Explorer submission was sent.
