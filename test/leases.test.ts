import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {TransactionHashVariant} from 'genlayer-js/types';
import {generateLeaseContract, normalizeLeasePolicy, auditLeaseGrant, auditLeaseConsumption, auditLeaseRevocation, createLeaseClient} from '../dist/leases.js';
import type {LeaseInput, LeaseGrant, LeaseConsumption} from '../dist/leases.js';
import {resolutionDigest} from '../dist/resolution.js';

const address = `0x${'1'.repeat(40)}` as const;
const controller = `0x${'2'.repeat(40)}` as const;
const hash = `0x${'a'.repeat(64)}` as const;
const requestId = `0x${'b'.repeat(64)}` as const;
function input(): LeaseInput {
  return {gateId: 'AGENT-JOBS', controller, oracles: [{id: 'LICENSE', contractAddress: address, expectedSpecHash: hash,
    marketId: 'LICENSE-CHECK', allowedOutcomes: ['PERMITTED'], minimumConfidenceBps: 9000, minimumSources: 1, maxAgeSeconds: 3600}],
    capabilities: [{id: 'BUILD-JOBS', subject: address, resourceHash: hash, oracles: ['LICENSE'], leaseSeconds: 300, maxUses: 3}]};
}
function fixture() {
  const generated = generateLeaseContract(input());
  const sealGrant = (body: Omit<LeaseGrant, 'grantHash'>): LeaseGrant => ({...body, grantHash: resolutionDigest(body)});
  const sealReceipt = (body: Omit<LeaseConsumption, 'receiptHash'>): LeaseConsumption => ({...body, receiptHash: resolutionDigest(body)});
  const identity = {version: 1 as const, gateId: generated.manifest.gateId, manifestHash: generated.manifestHash,
    chainId: 61997, contractAddress: address, capabilityId: 'BUILD-JOBS', subject: address, resourceHash: hash};
  const oracles = [{id: 'LICENSE', contractAddress: address, specHash: hash, outcomeId: 'PERMITTED', evidenceDigest: hash, observedAt: 1900}];
  const grant = sealGrant({...identity, kind: 'LEASE_GRANT', epoch: 1, issuedAt: 2000, expiresAt: 2300,
    usedAtGrant: 0, previousGrantHash: null, oracles});
  const receipt = sealReceipt({...identity, kind: 'LEASE_CONSUMPTION', epoch: 1, grantHash: grant.grantHash,
    requestId, consumedAt: 2010, sequence: 1, oracles});
  return {...generated, grant, receipt, sealGrant, sealReceipt};
}

test('lease policy generation is deterministic, pinned and detached from input', () => {
  const value = input(); value.capabilities.push({...value.capabilities[0], id: 'OTHER-JOBS'});
  const first = generateLeaseContract(value); value.capabilities.reverse();
  assert.equal(first.source, generateLeaseContract(value).source);
  assert.equal(first.manifestHash, resolutionDigest(first.manifest));
  assert.match(first.source.split('\n')[0], /Depends.*py-genlayer:1jb45/);
  first.manifest.capabilities[0].maxUses = 100;
  assert.equal(generateLeaseContract(input()).manifest.capabilities[0].maxUses, 3);
});
const invalid: Array<[string, (value: any) => void]> = [
  ['version', v => v.version = 2], ['kind', v => v.kind = 'WORKFLOW'],
  ['short TTL', v => v.capabilities[0].leaseSeconds = 29], ['long TTL', v => v.capabilities[0].leaseSeconds = 86401],
  ['fractional TTL', v => v.capabilities[0].leaseSeconds = 30.5], ['zero budget', v => v.capabilities[0].maxUses = 0],
  ['oversized budget', v => v.capabilities[0].maxUses = 1_000_001], ['boolean budget', v => v.capabilities[0].maxUses = true],
  ['zero controller', v => v.controller = '0x' + '0'.repeat(40)], ['empty capabilities', v => v.capabilities = []],
  ['duplicate capability', v => v.capabilities.push(v.capabilities[0])], ['unknown oracle', v => v.capabilities[0].oracles = ['UNKNOWN']],
  ['zero subject', v => v.capabilities[0].subject = '0x' + '0'.repeat(40)], ['invalid resource', v => v.capabilities[0].resourceHash = 'arbitrary'],
  ['injected class', v => v.className = 'Gate: pass\nexec(1)'],
];
for (const [name, mutate] of invalid) test(`lease generation rejects ${name}`, () => {
  const value = input(); mutate(value); assert.throws(() => generateLeaseContract(value));
});
test('offline audits bind grants and job admissions without claiming finality', () => {
  const f = fixture();
  assert.equal(auditLeaseGrant(f.manifest, f.grant).finality, 'CLAIMED_ONLY');
  assert.equal(auditLeaseConsumption(f.manifest, f.grant, f.receipt).integrity, 'VERIFIED');
  const bad = structuredClone(f.receipt); bad.sequence = 2;
  assert.throws(() => auditLeaseConsumption(f.manifest, f.grant, bad), /HASH/);
});
for (const [name, mutate, error] of [
  ['subject', (g: any) => g.subject = controller, 'EFFECT'],
  ['resource', (g: any) => g.resourceHash = requestId, 'EFFECT'],
  ['lease extension', (g: any) => g.expiresAt = 2301, 'BOUNDS'],
  ['evidence freshness', (g: any) => { g.issuedAt = 4000; g.expiresAt = 4300; g.oracles[0].observedAt = 500; }, 'FRESHNESS'],
  ['initial budget', (g: any) => g.usedAtGrant = 1, 'BOUNDS'],
  ['initial parent', (g: any) => g.previousGrantHash = hash, 'BOUNDS'],
  ['renewal parent', (g: any) => g.epoch = 2, 'BOUNDS'],
] as const) test(`rehashed grant rejects ${name}`, () => {
  const f = fixture(); const {grantHash, ...body} = structuredClone(f.grant); mutate(body);
  assert.throws(() => auditLeaseGrant(f.manifest, f.sealGrant(body)), new RegExp(error));
});
for (const [name, mutate, error] of [
  ['expired use', (r: any) => r.consumedAt = 2300, 'WINDOW'], ['premature use', (r: any) => r.consumedAt = 1999, 'WINDOW'],
  ['budget overflow', (r: any) => r.sequence = 4, 'WINDOW'], ['zero sequence', (r: any) => r.sequence = 0, 'WINDOW'],
  ['wrong grant', (r: any) => r.grantHash = hash, 'BINDING'], ['wrong epoch', (r: any) => r.epoch = 2, 'BINDING'],
  ['cross chain', (r: any) => r.chainId = 1, 'BINDING'], ['cross deployment', (r: any) => r.contractAddress = controller, 'BINDING'],
  ['unsupported outcome', (r: any) => r.oracles[0].outcomeId = 'RESTRICTED', 'POLICY'],
  ['future observation', (r: any) => r.oracles[0].observedAt = 2011, 'POLICY'],
  ['foreign oracle', (r: any) => r.oracles[0].id = 'OTHER', 'ORACLES'],
] as const) test(`rehashed consumption rejects ${name}`, () => {
  const f = fixture(); const {receiptHash, ...body} = structuredClone(f.receipt); mutate(body);
  assert.throws(() => auditLeaseConsumption(f.manifest, f.grant, f.sealReceipt(body)), new RegExp(error));
});
test('renewal audit preserves the spent budget floor', () => {
  const f = fixture(); const {grantHash, ...body} = f.grant;
  const renewed = f.sealGrant({...body, epoch: 2, usedAtGrant: 1, previousGrantHash: grantHash});
  const {receiptHash, ...use} = f.receipt;
  assert.throws(() => auditLeaseConsumption(f.manifest, renewed, f.sealReceipt({...use, epoch: 2, grantHash: renewed.grantHash})), /WINDOW/);
});
test('revocation audit binds the controller action to one deployment and reason', async () => {
  const f = fixture(); const {kind, epoch, grantHash, issuedAt, expiresAt, usedAtGrant, previousGrantHash, oracles, ...identity} = f.grant;
  const body = {...identity, kind: 'LEASE_REVOCATION' as const, epoch: 1, reasonHash: hash, revokedAt: 2010};
  const record = {...body, revocationHash: resolutionDigest(body)};
  assert.equal(auditLeaseRevocation(f.manifest, record).finality, 'CLAIMED_ONLY');
  assert.throws(() => auditLeaseRevocation(f.manifest, {...record, reasonHash: requestId}), /HASH/);
  const client = createLeaseClient({chainId: 61997, contractAddress: address, expectedManifest: f.manifest,
    reader: {async getChainId() { return 61997; }, async readContract(q) { return q.functionName === 'get_manifest' ? f.manifest : record; }}});
  assert.equal((await client.revocation('BUILD-JOBS')).value.reasonHash, hash);
});
test('client pins deployment and manifest, reads finalized history, builds unsigned requests', async () => {
  const f = fixture(); const calls: any[] = []; let chain = 61997; let manifest: unknown = f.manifest; let receipt = f.receipt;
  const reader = {async getChainId() { return chain; }, async readContract(q: any) {
    calls.push(q); return JSON.stringify(q.functionName === 'get_manifest' ? manifest : q.functionName === 'get_grant' ? f.grant :
      q.functionName === 'get_consumption' ? receipt : {...f.grant, epoch: 1, used: 0, maxUses: 3, revoked: false, status: 'ACTIVE', blockers: []});
  }};
  const config = {reader, chainId: 61997, contractAddress: address, expectedManifest: f.manifest};
  const client = createLeaseClient(config); config.expectedManifest.capabilities[0].maxUses = 999;
  // The input must be restored for the synthetic RPC, not for the pinned client.
  manifest = generateLeaseContract(input()).manifest;
  assert.equal((await client.preview('BUILD-JOBS')).advisory, true);
  assert.equal((await client.grant('BUILD-JOBS', 1)).value.grantHash, f.grant.grantHash);
  assert.equal((await client.consumption('BUILD-JOBS', requestId)).value.receiptHash, f.receipt.receiptHash);
  assert.ok(calls.every(q => q.transactionHashVariant === TransactionHashVariant.LATEST_FINAL));
  assert.deepEqual(client.renewRequest('BUILD-JOBS', 0), {address, functionName: 'renew', args: ['BUILD-JOBS', 0], value: 0n});
  assert.deepEqual(client.consumeRequest('BUILD-JOBS', 1, requestId).args, ['BUILD-JOBS', 1, requestId]);
  assert.equal(client.revokeRequest('BUILD-JOBS', hash).value, 0n);
  receipt = {...f.receipt, requestId: hash}; await assert.rejects(client.consumption('BUILD-JOBS', requestId), /REQUEST_MISMATCH/);
  manifest = {...manifest as object, gateId: 'SUBSTITUTED'}; await assert.rejects(client.preview('BUILD-JOBS'), /MANIFEST_MISMATCH/);
  chain = 1; await assert.rejects(client.preview('BUILD-JOBS'), /CHAIN_MISMATCH/);
  assert.throws(() => client.renewRequest('UNKNOWN', 0), /UNKNOWN/);
  assert.throws(() => client.consumeRequest('BUILD-JOBS', 0, requestId));
});
test('RPC errors are sanitized and a contradictory active preview is rejected', async () => {
  const f = fixture(); let fail = false;
  const client = createLeaseClient({chainId: 61997, contractAddress: address, expectedManifest: f.manifest,
    reader: {async getChainId() { return 61997; }, async readContract(q) {
      if (fail) throw Error('secret-provider-token');
      return q.functionName === 'get_manifest' ? f.manifest : {...f.grant, used: 3, maxUses: 3, revoked: true, status: 'ACTIVE', blockers: []};
    }}});
  await assert.rejects(client.preview('BUILD-JOBS'), /INVALID_LEASE_PREVIEW/);
  fail = true; await assert.rejects(client.preview('BUILD-JOBS'), /^Error: LEASE_RPC_READ_FAILED$/);
});
test('lease CLI generates once and audits a portable consumption bundle', async () => {
  const f = fixture(); const directory = await mkdtemp(join(tmpdir(), 'gavel-lease-'));
  try {
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(f.manifest));
    await writeFile(join(directory, 'bundle.json'), JSON.stringify({grant: f.grant, consumption: f.receipt}));
    const run = (...args: string[]) => spawnSync(process.execPath, ['bin/gavel.mjs', ...args], {encoding: 'utf8'});
    const args = ['generate-leases', join(directory, 'manifest.json'), join(directory, 'gate.py')];
    const generated = run(...args); assert.equal(generated.status, 0, generated.stderr); assert.equal(run(...args).status, 1);
    const audited = run('audit-lease', join(directory, 'manifest.json'), join(directory, 'bundle.json'));
    assert.equal(audited.status, 0, audited.stderr); assert.equal(JSON.parse(audited.stdout).finality, 'CLAIMED_ONLY');
  } finally { await rm(directory, {recursive: true, force: true}); }
});
