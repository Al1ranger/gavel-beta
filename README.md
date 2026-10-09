# Gavel Beta

**Evidence-aware prediction markets and intelligent oracles for GenLayer.**

Gavel Beta turns a typed JavaScript specification into a pinned, deployable GenLayer intelligent contract. Validators retrieve approved public evidence independently, reach consensus, and persist the result with its specification hash and evidence digest.

## Install

```bash
npm i gavel-judgment-sdk
```

Node.js 22.13 or newer is required. npm version 0.1.4 enforces mandatory resolution rules through leader and validator paths. See [release notes](docs/RELEASE-NOTES.md) and the [Studio Next guide](docs/STUDIO-NEXT.md).

The published npm package and CLI retain their `gavel-judgment-sdk` and `gavel` names for compatibility during the beta rename.

## Generate an intelligent contract

```ts
import { writeFile } from 'node:fs/promises';
import { earthquakeDemoContract } from 'gavel-judgment-sdk/contracts';

const generated = earthquakeDemoContract();
await writeFile('earthquake_resolver.py', generated.source);
await writeFile('earthquake_resolver.json', JSON.stringify(generated.compiledSpec, null, 2));
```

The generated Python contract pins a concrete GenVM runner, restricts evidence to explicit HTTPS origins, and stores deterministic hashes that clients can verify. Any declared rule marked `satisfied: false` forces `UNRESOLVED`; validators reject a `RESOLVED` candidate with that rule even when their model agrees.

## Build a custom market

```ts
import { generateIntelligentContract } from 'gavel-judgment-sdk/contracts';

const contract = generateIntelligentContract({
  className: 'GavelElectionResolver',
  spec: {
    marketId: 'CERTIFIED-ELECTION',
    question: 'Did candidate A win the certified election?',
    outcomes: [
      { id: 'YES', index: 0, label: 'Candidate A won' },
      { id: 'NO', index: 1, label: 'Candidate A did not win' },
    ],
    resolutionRules: ['Use the final certified result. Return UNRESOLVED on conflict.'],
    resolutionTime: 1782864000,
    approvedSources: ['https://results.example.gov/final.json'],
    sourcePolicy: { authority: 'Official election authority' },
  },
  shape: { kind: 'BINARY' },
  evidence: {
    sources: [{ url: 'https://results.example.gov/final.json' }],
  },
});
```

## Finalized resolution actions (0.2.0)

`gavel-judgment-sdk/resolution` connects a generated categorical verdict to an
application-owned downstream action. It obtains fresh finalized state, checks
receipt identity, specification and evidence hashes, mandatory rules/features,
confidence, source coverage, supporting quotes and age limits. Atomic action
reservations prevent duplicate callbacks across retries and local workers.

Portable JSON audit bundles can be reviewed with `gavel audit-resolution`.
Offline hashes check integrity, not chain authenticity; execution always uses
the consuming application's trusted RPC. Interrupted actions require explicit
reconciliation. The SDK never sends a payment.

From a source checkout:

```bash
npm run build
node examples/resolution-action.ts
node bin/gavel.mjs audit-resolution artifacts/resolution-action-demo/bundle.json artifacts/resolution-action-demo/policy.json
```

The example uses an explicitly synthetic RPC and releases one local job. Reruns
perform zero additional writes. [Integration API and trust model](docs/RESOLUTION-ACTIONS.md).

## Oracle modes

| Generator | Result | Use case |
| --- | --- | --- |
| `generateIntelligentContract` | Categorical verdict | Prediction markets, claims, event resolution |
| `generateScalarOracle` | Numeric observation and payout weights | Temperature, rainfall, prices, indexes |
| `generateOddsJournal` | Consensus odds snapshots | Auditable market history and agent signals |

`gavelDeliveryProofContract()` is a reproducible proof recipe that acquires the public SDK README inside the nondeterministic flow and binds validator agreement to its normalized evidence digest and approval decision.

`createOracleClient` reads contract state and defaults to finalized results. API helpers build evidence policies and preview public JSON. Platform modules add lifecycle certificates, validator consensus, evidence graphs, simulation, replay, and contract auditing.

## Deploy with GenLayer CLI

### Latest verified Studio Next deployment

[USGS earthquake resolver](https://explorer-studio-dev.genlayer.com/address/0xc1Cb384F4160FD7bC02E7aA26e21286c09352351) deployed on **chain 61997** through the SDK-generated deployment workflow. Transaction: `0xb06041b3754fce361e7d399049b0bd5972714120743f2ea9aa5bb74ef1732ed8`. Verified `FINALIZED` and `FINISHED_WITH_RETURN`; `get_progress` returned `{ attempts: 0, maxAttempts: 8, resolved: false }`. Deployment and reads are verified; evidence judgment has not been executed. [Machine-readable proof](docs/deployments/studio-next-earthquake.json).

### Patched public delivery resolver

[Gavel SDK public delivery resolver on Studio Next](https://explorer-studio-dev.genlayer.com/address/0xd801fA1479EdF2E8D5D9C42e918D6ea69070bF60) is deployed on **chain ID 61997**. Deployment transaction: `0x472fa739519d6454d409fd4ab54001b4b8ca880274cc16f9d019d3919255d888`; verified `FINALIZED` with `FINISHED_WITH_RETURN`. Reading `get_progress` returned `{ attempts: 0, maxAttempts: 8, resolved: false }`.

This deployment adds `# v0.2.0` before the generated pinned runner header and supplies both the live fee estimate's `distribution` and `feeValue`. Its deployment is verified; evidence resolution has not been run.

```bash
npm run build
npm run generate:examples
genlayer network set studionet
genlayer deploy --contract artifacts/studionet-samples/usgs_reviewed_2024_resolver.py
genlayer deploy --contract artifacts/studionet-samples/berlin-temperature-20240701_scalaroracle.py
```

Two SDK-generated examples are live on GenLayer StudioNet. Addresses, transaction hashes, and verification commands are in [StudioNet deployments](docs/STUDIONET-DEPLOYMENTS.md).

## Architecture

```text
gavel-beta/
├── bin/                     CLI entry point
├── demo/                    Local product demo
├── docs/                    Architecture, oracle, backend, deployment guides
├── examples/                Generation and live API examples
├── src/
│   ├── api/                 Typed backend API client
│   ├── core/                Lifecycle, certificates, events, contract engine
│   ├── evidence/            Fetch, normalize, verify, provenance graph
│   ├── markets/             Binary, scalar, continuous, odds primitives
│   ├── oracle/              Validators, consensus, confidence, reputation
│   ├── security/            Audit and attack detection
│   ├── simulation/          Adversarial simulation and replay
│   ├── contracts.ts         Stable contract-generation exports
│   ├── generate.ts          Categorical contract generator
│   ├── oracles.ts           Scalar and odds-journal generators
│   └── oracleClient.ts      Finality-aware onchain reader
└── test/                    TypeScript, Python, browser, integration tests
```

See [oracle architecture](docs/ORACLE-ARCHITECTURE.md), [oracle API](docs/ORACLES.md), and [backend integration](docs/BACKEND.md).

Real-world judgment patterns are documented in [Real-world judgments](docs/REAL-WORLD-JUDGMENTS.md), including supplier delivery disputes, moderation appeals, insurance triage, and prediction-market resolution.

### Studio Next developer deployment

Prepare a deployment project for Studio Next (chain ID `61997`) from a generated, zero-argument Gavel contract:

```bash
npx gavel prepare-studio-next earthquake_resolver.py studio-next-deployment
cd studio-next-deployment
npx --yes genlayer@0.40.0-rc.3 network set studio-dev
npx --yes genlayer@0.40.0-rc.3 account list
npx --yes genlayer@0.40.0-rc.3 deploy
```

Select or create your deployment account with GenLayer CLI first. The generated script checks chain 61997, adds the verified `# v0.2.0` header, obtains a live fee estimate, and submits both distribution and fee value. Signing stays in GenLayer CLI. It saves `transaction.json` immediately after submission and resumes that transaction on rerun. Success requires finalization and `FINISHED_WITH_RETURN`; the script prints the Studio Next explorer link and saves `receipt.json`.

The fee allocation is a development preset for these generated contracts, not a measured profile for arbitrary contracts. Review it before signing. Constructor arguments default to empty. Studio Next can reset its state. The stable SDK client continues to use genlayer-js 1.x; Studio Next deployment uses the compatible CLI rather than an incomplete chain definition. `npx gavel studio-next-info` prints its canonical endpoints.

## Trust model

- Installing the SDK does not deploy a contract or prove an external fact.
- An evidence digest proves which normalized evidence was used; validator consensus determines the accepted result.
- `ACCEPTED` and `FINALIZED` are distinct lifecycle states. Settlement code must wait for successful finalization.
- `UNRESOLVED` is a valid result and must never be treated as a winning outcome.
- The SDK never creates, stores, or exposes wallet private keys.

## Development

```bash
npm ci
npm run build
npm test
npm run test:contracts
npm pack --dry-run
```

License: MIT

## Developer site

Interactive deployment guide: https://gavel-beta-sdk.vercel.app/
Docs: https://gavel-beta-sdk.vercel.app/docs
