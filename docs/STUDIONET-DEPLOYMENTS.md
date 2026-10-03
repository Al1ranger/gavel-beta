# StudioNet deployments

The StudioNet deployments below are historical (September 14, 2026). Their categorical resolver code predates the 0.1.4 mandatory-rule fix. Use the patched Studio Next earthquake and public-delivery deployments listed below; the old contracts are immutable. The scalar oracle is unaffected by this categorical-rule fix.

Network: **GenLayer StudioNet** (`chainId 61999`)

## Gavel SDK public delivery proof

- Contract: `GavelGavelSdkPublicDeliveryResolver`
- Address: `0xC6B2F8336E1e56f2eCb62B742fcE4A23aE210ccC`
- Deployment transaction: `0xafac8f2ec971710711a2d9e51a53c3064d3372487a2fe160ee4dee4b5c144a30`
- Proof transaction: `0xa385a693d686052a696a79cd5b33606dda57344ac1eb99c59f34e2923a27cb22`
- Deployment result: `ACCEPTED`, `MAJORITY_AGREE`, five validator votes `AGREE`
- Proof result: `UNRESOLVED / INSUFFICIENT_EVIDENCE`, accepted by validator consensus because StudioNet could not acquire the configured public source during this attempt
- Evidence source: public main-branch README from `raw.githubusercontent.com`

The proof transaction demonstrates the required fail-closed behavior: validators independently rerun acquisition, agree on the evidence digest and threshold side, and refuse to certify delivery when the source is unavailable. A later `resolve` retry may produce `VERIFIED` after StudioNet outbound acquisition becomes available.

## USGS reviewed earthquake resolver

- Contract: `GavelUsgsReviewed2024Resolver`
- Address: `0x86B29A2202c19910a211D58A49A45A155E5FDFE6`
- Deployment transaction: `0xe7f511e3da7b951068bfe53a4dd5839b02611376873997e9d1579fae19ad5d82`
- Deployment result: `ACCEPTED`, `MAJORITY_AGREE`, leader execution `SUCCESS`
- Evidence source: USGS public earthquake API

## Berlin temperature scalar oracle

- Contract: `GavelScalarOracle`
- Address: `0x1C5FB34a0aa88bB35150396b94F4Bf91D26d9471`
- Deployment transaction: `0x325ffd095ac02352da643346c045156aafeaba224e7849f7f91ca3267b18acac`
- Deployment result: `ACCEPTED`, `MAJORITY_AGREE`, leader execution `SUCCESS`
- Evidence source: Open-Meteo historical weather API

## Verify with GenLayer CLI

```bash
genlayer network set studionet
genlayer code 0xC6B2F8336E1e56f2eCb62B742fcE4A23aE210ccC
genlayer schema 0xC6B2F8336E1e56f2eCb62B742fcE4A23aE210ccC
genlayer code 0x86B29A2202c19910a211D58A49A45A155E5FDFE6
genlayer schema 0x86B29A2202c19910a211D58A49A45A155E5FDFE6
genlayer code 0x1C5FB34a0aa88bB35150396b94F4Bf91D26d9471
genlayer schema 0x1C5FB34a0aa88bB35150396b94F4Bf91D26d9471
```

An accepted deployment confirms validator agreement on deployment execution. Applications must still inspect transaction finality before using a later oracle result for settlement.

## Studio Next deployments (chain ID 61997)

These deployments use the compatible `# v0.2.0` runtime header and the Studio Next live fee estimate.

| Example | Contract | Deployment | Explorer |
| --- | --- | --- | --- |
| Public SDK delivery resolver | `0xd801fA1479EdF2E8D5D9C42e918D6ea69070bF60` | `0x472fa739519d6454d409fd4ab54001b4b8ca880274cc16f9d019d3919255d888` | [address](https://explorer-studio-dev.genlayer.com/address/0xd801fA1479EdF2E8D5D9C42e918D6ea69070bF60) |
| Supplier delivery claims resolver | `0x469413c7693EB86e846940DE5988ADDBA7A8CD26` | `0x7fc1303076ad36381519655f9abba411d3417fef67eb105e1d46d19e0b424494` | [address](https://explorer-studio-dev.genlayer.com/address/0x469413c7693EB86e846940DE5988ADDBA7A8CD26) |
| Content moderation appeals | `0xa7666ABE128355475e5fc065c77B45dc3c8Cf627` | `0xbb90143ce1a15a5fc6dc51924dbcd4faafc1c8e7edc90076b0c47d5f535aa501` | [address](https://explorer-studio-dev.genlayer.com/address/0xa7666ABE128355475e5fc065c77B45dc3c8Cf627) |

All three deployments finalized with `FINISHED_WITH_RETURN`. The claims and moderation examples expose pinned rules and initial `PENDING`/`UNREVIEWED` state; the public delivery resolver proof read returned `resolved: false`, `attempts: 0`, and `maxAttempts: 8`.

## Latest SDK workflow verification — 0.1.4

USGS earthquake resolver: [0xc1Cb384F4160FD7bC02E7aA26e21286c09352351](https://explorer-studio-dev.genlayer.com/address/0xc1Cb384F4160FD7bC02E7aA26e21286c09352351). Chain **61997**; transaction `0xb06041b3754fce361e7d399049b0bd5972714120743f2ea9aa5bb74ef1732ed8`.

Both patched categorical recipes finalized with `FINISHED_WITH_RETURN`; deployed source hashes match SDK 0.1.4 generation. See the [public-delivery proof](deployments/studio-next-delivery.json).

Verified `FINALIZED` / `FINISHED_WITH_RETURN`. The read-only `get_progress` call returned `{ attempts: 0, maxAttempts: 8, resolved: false }`. Judgment resolution has not been executed. Source hashes and superseded addresses are recorded in the deployment proofs.

See [deployment guide](STUDIO-NEXT.md) and [deployment proof](deployments/studio-next-earthquake.json).
