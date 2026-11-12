// Write integration on Studio Next. Run from the repo root after building
// the SDK and running npm ci in examples/live-resolution-action.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {createAccount, createClient} from 'genlayer-js';
import {studioDevnet} from 'genlayer-js/chains';
import {TransactionHashVariant} from 'genlayer-js/types';
import {getAddress} from 'viem';
import {createLeaseClient, generateLeaseContract} from '../../dist/leases.js';
import {resolutionDigest} from '../../dist/resolution.js';

const chainId = 61997;
const sha = text => createHash('sha256').update(text).digest('hex');
const hash = text => `0x${sha(text)}`;
const capability = 'BUILD-JOB';
const subject = createAccount();
const controller = createAccount();
const client = createClient({chain: studioDevnet, account: subject});
const owner = createClient({chain: studioDevnet, account: controller});
const read = (address, functionName) => client.readContract({
  address, functionName, args: [], transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
});
const v1 = JSON.parse(await readFile(new URL('../../docs/deployments/resolution-actions-studio-next.json', import.meta.url), 'utf8'));
const transactions = {};
let stage = 'preflight';
let output;

async function save(name, value) {
  await writeFile(`${output}/${name}.json`, JSON.stringify(value, null, 2) + '\n');
}

async function indexed(readState) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await readState();
    } catch (error) {
      if (attempt === 9) throw error;
      await delay(2000);
    }
  }
}

async function send(name, signer, submit, expectedError) {
  stage = name;
  const quote = await signer.estimateTransactionFees({
    leaderTimeunitsAllocation: 100n, validatorTimeunitsAllocation: 200n,
    rotations: [3n], appealRounds: 0n, totalMessageFees: 0n,
  });
  assert.ok(quote.feeValue <= 11n * 10n ** 16n, 'Fee exceeds 0.11 test GEN');
  const tx = await submit({distribution: quote.distribution, feeValue: quote.feeValue});
  transactions[name] = {hash: tx};
  await save('transactions', transactions);
  console.log(JSON.stringify({stage, hash: tx}));
  const receipt = await signer.waitForTransactionReceipt({
    hash: tx, waitUntil: 'finalized', fullTransaction: true, retries: 120, interval: 3000,
  });
  const execution = receipt.txExecutionResultName;
  assert.equal(receipt.statusName, 'FINALIZED');
  assert.equal(receipt.result_name, 'MAJORITY_AGREE');
  assert.equal(receipt.leader_only, false);
  assert.equal(execution, expectedError ? 'FINISHED_WITH_ERROR' : 'FINISHED_WITH_RETURN');
  if (expectedError) {
    const leader = receipt.consensus_data?.leader_receipt?.map(({result, genvm_result}) => ({result, stderr: genvm_result?.stderr}));
    assert.ok(JSON.stringify(leader)?.includes(expectedError));
  }
  Object.assign(transactions[name], {status: 'FINALIZED', consensus: 'MAJORITY_AGREE', execution},
    expectedError && {rejection: expectedError});
  await save('transactions', transactions);
  console.log(JSON.stringify({stage, execution}));
  return receipt;
}

async function run() {
  assert.equal(Number(await client.getChainId()), chainId);
  assert.equal(await client.getGasPrice(), 0n);
  assert.equal(sha(await client.getContractCode(v1.address)), v1.sourceSha256);
  const spec = JSON.parse(await read(v1.address, 'get_spec'));
  const verdict = JSON.parse(await read(v1.address, 'get_verdict'));
  assert.equal(resolutionDigest(spec), v1.specHash);
  assert.equal(verdict.status, 'RESOLVED');
  assert.equal(verdict.outcomeId, v1.outcomeId);
  assert.equal(verdict.evidenceDigest, v1.evidenceDigest);
  const maxAgeSeconds = 90 * 86400;
  assert.ok(Date.now() / 1000 - verdict.observedAt + 86400 < maxAgeSeconds);

  await mkdir('artifacts', {recursive: true});
  output = await mkdtemp('artifacts/lease-studio-next-');
  console.log(JSON.stringify({output}));
  const generated = generateLeaseContract({
    gateId: 'LEASE-STUDIO-NEXT', controller: controller.address,
    oracles: [{id: 'LICENSE', contractAddress: v1.address, expectedSpecHash: v1.specHash,
      marketId: spec.marketId, allowedOutcomes: [v1.outcomeId], minimumConfidenceBps: 8500,
      minimumSources: 1, maxAgeSeconds}],
    capabilities: [{id: capability, subject: subject.address, resourceHash: hash('gavel-studio-next:build-job'),
      oracles: ['LICENSE'], leaseSeconds: 3600, maxUses: 2}],
  });
  const source = '# v0.2.0\n' + generated.source;
  await save('manifest', generated.manifest);
  await writeFile(`${output}/gate.py`, source);
  stage = 'testnet faucet';
  for (const account of [subject, controller]) {
    await client.request({method: 'sim_fundAccount', params: [account.address, 1_000_000_000_000_000_000]});
  }
  const deployed = await send('deploy', client, fees => client.deployContract({
    code: Buffer.from(source), args: [], fees,
  }));
  const address = getAddress(deployed.data?.contract_address ?? deployed.txDataDecoded?.contractAddress);
  const sourceSha256 = sha(source);
  stage = 'verify deployment';
  await save('deployment', {chainId, address, sourceSha256});
  assert.equal(sha(await indexed(() => client.getContractCode(address))), sourceSha256);

  const gate = createLeaseClient({reader: client, chainId, contractAddress: address, expectedManifest: generated.manifest});
  const write = (name, signer, request, error) => send(name, signer, fees => signer.writeContract({...request, fees}), error);
  const preview = async () => (await indexed(() => gate.preview(capability))).value;
  assert.equal((await preview()).status, 'NOT_OPEN');
  await write('open', client, gate.renewRequest(capability, 0));
  const grant = (await indexed(() => gate.grant(capability, 1))).value;
  assert.equal((await preview()).status, 'ACTIVE');
  const request = gate.consumeRequest(capability, 1, hash('build-job:request-1'));
  await write('consume', client, request);
  const consumption = (await indexed(() => gate.consumption(capability, request.args[2]))).value;
  assert.equal(consumption.sequence, 1);
  await write('renew', client, gate.renewRequest(capability, 1));
  const renewal = (await indexed(() => gate.grant(capability, 2))).value;
  assert.equal(renewal.usedAtGrant, 1);
  assert.equal(renewal.previousGrantHash, grant.grantHash);
  await write('revoke', owner, gate.revokeRequest(capability, hash('controller:revoke-demo')));
  const revocation = (await indexed(() => gate.revocation(capability))).value;
  assert.equal(revocation.epoch, 2);
  await write('replay', client, request);
  assert.deepEqual((await gate.consumption(capability, request.args[2])).value, consumption);
  await write('rejectedAfterRevocation', client, gate.consumeRequest(capability, 2, hash('build-job:request-2')), 'LEASE_REVOKED');
  const state = await preview();
  assert.equal(state.used, 1);
  assert.equal(state.status, 'REVOKED');
  await save('proof', {checkedAt: new Date().toISOString(), chainId, address, sourceSha256,
    manifest: generated.manifest, manifestHash: generated.manifestHash, transactions, grant, consumption, renewal, revocation, state});
  console.log(JSON.stringify({stage: 'verified', address, output, used: state.used, status: state.status}));
}

// Do not echo provider errors or full RPC receipts. Inspect saved hashes on the explorer.
console.error = () => {};
try {
  await run();
} catch (error) {
  let root = error;
  for (let i = 0; i < 8 && root?.cause; i++) root = root.cause;
  const code = typeof root?.code === 'number' ? root.code : null;
  console.log(JSON.stringify({stage, output, ok: false, errorType: error?.name, rpcCode: code}));
  process.exitCode = 1;
}
