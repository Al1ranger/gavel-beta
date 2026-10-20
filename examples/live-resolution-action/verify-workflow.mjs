// Read-only reproduction of committed live evidence. No signer or writes.
import {createClient} from 'genlayer-js';
import {studioDevnet} from 'genlayer-js/chains';
import {TransactionHashVariant} from 'genlayer-js/types';
import {getAddress} from 'viem';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createWorkflowClient,auditWorkflowChain} from '../../dist/workflow.js';
import {resolutionDigest} from '../../dist/resolution.js';

const proof=JSON.parse(await readFile(new URL('../../docs/deployments/workflow-gates-studio-next.json',import.meta.url),'utf8'));
const client=createClient({chain:studioDevnet});
const sha=text=>createHash('sha256').update(text).digest('hex');
assert.equal(Number(await client.getChainId()),proof.chainId);
assert.equal(sha(await client.getContractCode(proof.gate.address)),proof.gate.sourceSha256);
assert.equal(sha(await client.getContractCode(proof.oracle.address)),proof.oracle.sourceSha256);
assert.equal(resolutionDigest(proof.manifest),proof.manifestHash);
for(const policy of proof.manifest.oracles){
  const spec=JSON.parse(await client.readContract({address:getAddress(policy.contractAddress),functionName:'get_spec',args:[],transactionHashVariant:TransactionHashVariant.LATEST_FINAL}));
  assert.equal(resolutionDigest(spec),policy.expectedSpecHash);
}
const gate=createWorkflowClient({reader:client,chainId:proof.chainId,contractAddress:proof.gate.address,expectedManifest:proof.manifest});
const receipts=[];
for(const checkpoint of proof.manifest.checkpoints){
  const actual=(await gate.completion(checkpoint.id)).value;
  assert.deepEqual(actual,proof.receipts.find(r=>r.checkpointId===checkpoint.id));receipts.push(actual);
  assert.equal((await gate.preview(checkpoint.id)).value.status,'COMPLETED');
}
assert.equal(auditWorkflowChain(proof.manifest,receipts).integrity,'VERIFIED');
const expectedErrors={missingDependency:'CHECKPOINT_DEPENDENCY_REQUIRED',unauthorizedActor:'CHECKPOINT_ACTOR_REQUIRED',unresolvedOracle:'VERDICT_NOT_AVAILABLE'};
for(const [name,hash]of Object.entries(proof.transactions)){
  const receipt=await client.getTransaction({hash});assert.equal(receipt.statusName,'FINALIZED');
  assert.equal(receipt.txExecutionResultName,expectedErrors[name]?'FINISHED_WITH_ERROR':'FINISHED_WITH_RETURN');
  if(expectedErrors[name]){
    const result=JSON.stringify(receipt.consensus_data?.leader_receipt?.map(r=>({result:r.result,stderr:r.genvm_result?.stderr})));
    assert.ok(result.includes(expectedErrors[name]),`Unexpected rejection for ${name}`);
  }
}
const progress=await client.readContract({address:proof.gate.address,functionName:'get_progress',args:[],transactionHashVariant:TransactionHashVariant.LATEST_FINAL});
assert.equal(progress.completed,2);
console.log(JSON.stringify({checkedAt:new Date().toISOString(),chainId:proof.chainId,gate:proof.gate.address,completed:2,receiptChain:'VERIFIED',controls:'VERIFIED',writes:0}));
