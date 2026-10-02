# Gavel Beta

**Evidence-aware prediction markets and intelligent oracles for GenLayer.**

Gavel Beta turns a typed JavaScript specification into a pinned, deployable GenLayer intelligent contract. Validators retrieve approved public evidence independently, reach consensus, and persist the result with its specification hash and evidence digest.

## Install

```bash
npm i gavel-judgment-sdk
```

Node.js 22.13 or newer is required. npm version 0.1.3 includes the tested developer-experience fixes. See [release notes](docs/RELEASE-NOTES.md) and the [Studio Next guide](docs/STUDIO-NEXT.md).

The published npm package and CLI retain their `gavel-judgment-sdk` and `gavel` names for compatibility during the beta rename.

## Generate an intelligent contract

```ts
import { writeFile } from 'node:fs/promises';
import { earthquakeDemoContract } from 'gavel-judgment-sdk/contracts';

const generated = earthquakeDemoContract();
await writeFile('earthquake_resolver.py', generated.source);
await writeFile('earthquake_resolver.json', JSON.stringify(generated.compiledSpec, null, 2));
```

The generated Python contract pins a concrete GenVM runner, restricts evidence to explicit HTTPS origins, and stores deterministic hashes that clients can verify.

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

[USGS earthquake resolver](https://explorer-studio-dev.genlayer.com/address/0xA059bF529c15fDd69ad5320F80DFd04bfc24A2F4) deployed on **chain 61997** through the SDK-generated deployment workflow. Transaction: `0x6760f2f13aa7861cbaddb830811c01b4d9868724ac04bfbc717eb082c68b4a3c`. Verified `FINALIZED` and `FINISHED_WITH_RETURN`; `get_progress` returned `{ attempts: 0, maxAttempts: 8, resolved: false }`. Deployment and reads are verified; evidence judgment has not been executed. [Machine-readable proof](docs/deployments/studio-next-earthquake.json).

### Earlier verified Studio Next deployment

[Gavel SDK public delivery resolver on Studio Next](https://explorer-studio-dev.genlayer.com/address/0x8aB6Bb90BABd7A37cACb5DC8Ef16E37A3D1d6cC5) is deployed on **chain ID 61997**. Deployment transaction: `0xfd5ce69672a404e99bb8670c1b36f750ed938eec282693dd547797a0d50c2aee`; verified `FINALIZED` with `FINISHED_WITH_RETURN`. Reading `get_progress` returned `{ attempts: 0, maxAttempts: 8, resolved: false }`.

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

Interactive deployment guide: https://gavel-beta-starling-spell.vercel.app/
Docs: https://gavel-beta-starling-spell.vercel.app/docs
