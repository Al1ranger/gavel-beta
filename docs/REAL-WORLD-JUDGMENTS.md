# Real-world Gavel judgments

Gavel is useful when a contract needs an on-chain decision about evidence that is public but not naturally deterministic.


## Verified deployment and current release

Use `npm install gavel-judgment-sdk@0.1.4`. [Studio Next deployment guide](STUDIO-NEXT.md) documents the verified earthquake resolver on chain **61997**: [0xc1Cb384F4160FD7bC02E7aA26e21286c09352351](https://explorer-studio-dev.genlayer.com/address/0xc1Cb384F4160FD7bC02E7aA26e21286c09352351). Its deployment finalized with `FINISHED_WITH_RETURN`, and `get_progress` was read successfully. Judgment resolution has not been executed.

The use cases below describe application designs, not completed judgments or verified payouts.

## Supplier delivery disputes

Buyer and supplier submit a shipment reference, delivery window, and approved evidence sources such as the carrier API and signed warehouse receipt. Validators independently retrieve the records, normalize timestamps and quantities, and agree on `DELIVERED`, `LATE`, `DAMAGED`, or `UNRESOLVED`. Escrow releases only after the decision is finalized; conflicting evidence stays unresolved and can be appealed.

## Content moderation appeals

A platform pins a moderation policy and the original post. Validators independently assess whether the post is impersonation, fraud, a targeted threat, or protected criticism. Gavel stores the policy hash, evidence digest, decision, and rationale so a user can appeal a reproducible decision rather than a private model response.

## Insurance claim triage

An insurer pins policy clauses, a claim packet, repair invoices, and an inspection source. Validators compare the same exclusions and evidence, returning `COVERED`, `PARTIAL`, `EXCLUDED`, or `UNRESOLVED`. The contract can authorize a capped payout only after successful finalization.

## Prediction-market resolution

A market pins its question, outcome IDs, resolution time, and approved sources. Validators independently fetch the official result, compare the stable outcome field, and store the result with a source digest. If sources disagree or disappear, the contract fails closed instead of inventing a winner.

The common pattern is: immutable rules → approved evidence → independent validator judgment → canonical result → finalized settlement or appeal.
