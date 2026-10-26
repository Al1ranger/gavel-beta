// Strict public consumer declaration check; no RPC or signer is created.
import {generateLeaseContract, createLeaseClient, auditLeaseGrant, auditLeaseConsumption, auditLeaseRevocation} from 'gavel-judgment-sdk/leases';
import {generateLeaseContract as rootExport} from 'gavel-judgment-sdk';
import type {LeaseGrant, LeaseConsumption, LeaseRevocation} from 'gavel-judgment-sdk/leases';

const address = `0x${'1'.repeat(40)}` as const;
const hash = `0x${'a'.repeat(64)}` as const;
const generated = generateLeaseContract({gateId: 'TEST-LEASES', controller: address,
  oracles: [{id: 'ORACLE', contractAddress: address, expectedSpecHash: hash, marketId: 'MARKET',
    allowedOutcomes: ['ALLOWED'], minimumConfidenceBps: 9000, minimumSources: 1, maxAgeSeconds: 3600}],
  capabilities: [{id: 'JOBS', subject: address, resourceHash: hash, oracles: ['ORACLE'], leaseSeconds: 300, maxUses: 3}]});
const client = createLeaseClient({reader: {async getChainId() { return 61997; }, async readContract() { throw new Error('Declaration check only'); }},
  chainId: 61997, contractAddress: address, expectedManifest: generated.manifest});
client.renewRequest('JOBS', 0);
client.consumeRequest('JOBS', 1, hash);
client.revokeRequest('JOBS', hash);
function audit(grant: LeaseGrant, consumption: LeaseConsumption, revocation: LeaseRevocation) {
  auditLeaseGrant(generated.manifest, grant);
  auditLeaseConsumption(generated.manifest, grant, consumption);
  auditLeaseRevocation(generated.manifest, revocation);
}
void audit;
void rootExport;
