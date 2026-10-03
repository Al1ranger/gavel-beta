# Backend oracle SDK

## Modules

| Module | Responsibility |
| --- | --- |
| contractEvidence | Bounded public-source acquisition, stable field projection, identity assertions |
| generate | Immutable AI-adjudicated event resolvers with evidence-bound retry history |
| oracles | Scalar observations and append-only odds journals |
| recipes | Historical USGS, Berlin weather, and caller-selected Polymarket examples |
| oracleClient | Typed generated-contract reads and caller-signed submissions |
| api | Non-authoritative GET/POST API previews |
| prediction / marketKinds | Odds conversion and terminal payout formatting |
| client / courtClient | Existing registry and court interfaces; separate contract ABIs |

Use focused imports: `gavel-judgment-sdk/contracts`, `/clients`, `/markets`,
`/evidence`, or `/api`. Existing root imports remain supported. Contract generation
and market validation do not need an RPC connection or a signer.

All public APIs are also exported from `gavel-judgment-sdk`. Contracts are generated as
self-contained Python with a pinned GenVM runner. No frontend is required.

## Generate an event resolver

```ts
import { writeFile } from 'node:fs/promises';
import { earthquakeDemoContract } from 'gavel-judgment-sdk';

const contract = earthquakeDemoContract();
await writeFile(contract.filename, contract.source, { flag: 'wx' });
```

For your own market use `generateIntelligentContract({ spec, shape, features,
evidence, minimumConfidenceBps, confidenceToleranceBps, maxAttempts,
retryDelaySeconds })`. Evidence source URLs must exactly match the normalized
spec's approved URLs. `fields` maps names to JSON paths, and `expect` checks exact
identity fields before a model sees the content. Deploy-time rules are immutable.

Default confidence gate: 8000 basis points; tolerance: zero. Even when tolerance
is configured, validators must agree on the threshold decision, winner, all
reported criterion booleans and evidence digest. Missing required features force
UNRESOLVED. All declared resolution rules are mandatory: any rule marked
`satisfied: false` deterministically forces `status: UNRESOLVED`,
`winnerIndex: -1`, and `outcomeId: UNRESOLVED`, even when the model proposes a
winner. Validators reject an unnormalized RESOLVED candidate with such a rule;
agreement between model answers cannot bypass the gate. Each resolved answer
requires source quotes and a complete rule audit.
Confidence describes evidence sufficiency, never future event odds.

UNRESOLVED attempts are recorded and can be retried after a cooldown. Defaults are
8 attempts and 60 seconds. Successful resolution is terminal. Any caller can
request resolution, so choose attempt limits with public-call exhaustion in mind.

## Numeric workflows

`weatherDemoContract()` emits a scalar oracle for Berlin's historical daily
maximum temperature on 2024-07-01. It uses the Open-Meteo archive's measurement
definition, not an assertion about an individual weather station. The 10-40°C
range maps continuously to complementary long/short payout weights. Inputs beyond
the range clamp to an endpoint. Weights sum to 10000; no funds are transferred.

`polymarketJournalContract(marketId, orderedLabels)` emits an odds journal for one
exact Gamma market. Discover the ID and labels from the API before generating.
The suite's ID `123` is a fixture only. Prices use exact 1e8 scaling; the journal
records margin coherence, timestamp and evidence. It never resolves the event.
Changing live prices may prevent exact validator agreement, intentionally.

## Read and submit

`createOracleClient` requires `network`, `contractAddress`, `expectedId`, and an
independently verified `expectedSpecHash`. Optional `rpcUrl`, `readClient`, and
`signer` support your application's infrastructure. The signer is an existing
GenLayer client; Gavel does not generate or manage keys.

- `submit('resolve' | 'observe' | 'sample')`: returns SUBMITTED and transaction hash.
- `verdict()`: adjudicated event result.
- `scalar()`: measurement and complementary payout weights.
- `snapshot(index)`: one immutable odds observation.

Reads default to finalized contract state. `{ provisional: true }` explicitly
selects non-final state. Finalized state is not a proof that an arbitrary supplied
transaction resolved a market. Trust your RPC and verify the deployment hash.
Use the registry client only with the shared registry ABI, not generated oracles.

## Verification commands

```sh
npm ci
npm run build
npm test
python -m pip install -r requirements-dev.txt
npm run generate:examples
genvm-lint check artifacts/oracles/usgs_reviewed_2024_resolver.py
genvm-lint check artifacts/oracles/berlin-temperature-20240701_scalaroracle.py
genvm-lint check artifacts/oracles/polymarket-123_oddsjournal.py
npm run test:contracts
npm run test:live-api
```

Generation refuses overwriting files; use a fresh output directory when rerunning.
The tests generate fresh artifacts themselves. Direct tests mock HTTP and models;
explicit validator-callback tests exercise independent comparison, not distributed
consensus. Live API checks also do not prove GenLayer consensus.

## Limits and source documentation

Public HTTPS GET evidence is supported inside generated contracts. Authenticated
POST previews do not make private APIs reproducible on-chain. Do not publish API
keys. Configure network egress restrictions in your validator infrastructure.
See [architecture and trust assumptions](ORACLE-ARCHITECTURE.md).

Source references: [GenLayer HTTP acquisition](https://docs.genlayer.com/developers/intelligent-contracts/examples/fetch-web-content),
[USGS GeoJSON](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php),
[Open-Meteo historical API](https://open-meteo.com/en/docs/historical-weather-api),
[Polymarket market data](https://docs.polymarket.com/market-data/overview).

Not yet verified: live deployment, distributed consensus, settlement integration,
or production security audit. This is a tested developer candidate, not a claim
of hackathon eligibility, originality relative to unseen submissions, or winnings.

## Current deployment reference

Package: `gavel-judgment-sdk@0.1.3`. For chain **61997**, use the [Studio Next guide](STUDIO-NEXT.md) and [verified deployment proof](deployments/studio-next-earthquake.json). Deployment and reads are verified; judgment resolution has not yet been executed. [Release notes](RELEASE-NOTES.md).
