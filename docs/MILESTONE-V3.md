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

- **259 SDK tests pass**, including 40 new lease cases.
- **133 contract tests pass**, including 43 new lease cases.
- Generated lease source passes GenVM AST lint and semantic/schema validation.
- Public root/subpath declarations compile with strict TypeScript and
  `skipLibCheck=false` using the documented structural reader interface.
- Package checks include compiled lease exports, declarations, runtime and guide.
- The generated source of the existing published workflow still hashes to
  `6ae39c6eed0447b2c532dc69f22a002982b5565f2b89485a770da1685811bee2`.
- [Machine-readable verification report](verification/authorization-leases.json).

## Scope

Source candidate version: **0.4.0**. npm publication is not claimed. The current
README installation command continues to point at the existing npm 0.3.0 release.

The Studio Next read-only preflight on October 25 returned RPC error `-32603`
when reading the previously deployed v2 workflow. No new lease deployment,
public-network consensus, token transfer or external job execution is claimed.
The tests mock oracle transport; their result does not establish live finality.

The contract records admission of one payload commitment to one resource.
Applications must bind the request hash to actual job arguments and deduplicate
external execution. Historical replay acknowledges an earlier admission even
after expiry/revocation; it does not grant current access. Offline hashes return
`finality: CLAIMED_ONLY` and require independent RPC/deployment authentication.
The immutable controller can permanently deny a capability but cannot override
an oracle or create a passing grant. Resolver data independence is not implied
by multiple configured addresses.

## Submission title

Gavel SDK: expiring, revocable authorization leases

## Changes & Improvements (947 / 1000 characters)

Added a new GenLayer lease gate for bounded agent/job access, extending v2's permanent workflow checkpoints with expiring authorization. Each capability pins a subject, resource hash, lifetime use cap and oracle policy. Opening, renewal and every new use recheck finalized resolver state, mandatory rules, confidence, evidence hashes, quotes and freshness. Leases cannot outlive their observations; renewal changes the epoch without resetting the use cap. Controller revocation permanently blocks new uses. Domain-bound grant and consumption receipts prevent cross-deployment substitution; replay returns only its historical receipt. Added finalized-state SDK reads, unsigned requests, portable integrity audits, generation/audit CLI and integration docs. All 259 SDK and 133 contract tests pass, including 83 new cases and Python-to-TypeScript audit parity. Version 0.4.0 is a source candidate; live consensus and npm publication are not claimed.

## Evidence

- [Delta from v2](https://github.com/Al1ranger/gavel-beta/compare/02e8e50...main)
- [Lease generator and public API](https://github.com/Al1ranger/gavel-beta/blob/main/src/leases.ts)
- [Contract state machine](https://github.com/Al1ranger/gavel-beta/blob/main/src/leaseRuntime.ts)
- [Contract regressions](https://github.com/Al1ranger/gavel-beta/blob/main/test/test_leases.py)
- [Verification report](https://github.com/Al1ranger/gavel-beta/blob/main/docs/verification/authorization-leases.json)

This is copy-ready draft text. No Project Explorer submission was sent.
