import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {TransactionHashVariant} from 'genlayer-js/types';
import {generateWorkflowContract,normalizeWorkflow,auditWorkflowCompletion,auditWorkflowChain,createWorkflowClient} from '../dist/workflow.js';
import {resolutionDigest} from '../dist/resolution.js';
import type {WorkflowInput,WorkflowCompletion} from '../dist/workflow.js';

const addr=`0x${'1'.repeat(40)}` as const;
const digest=`0x${'a'.repeat(64)}` as const;
function input():WorkflowInput{return {workflowId:'RELEASE-PIPELINE',oracles:[{id:'LICENSE',contractAddress:addr,expectedSpecHash:digest,
  marketId:'LICENSE-CHECK',allowedOutcomes:['PERMITTED'],minimumConfidenceBps:9000,minimumSources:1,maxAgeSeconds:3600}],
  checkpoints:[{id:'LEGAL',actor:addr,artifactHash:digest,requires:[],oracles:['LICENSE']},
    {id:'RELEASE',actor:addr,artifactHash:digest,requires:['LEGAL'],oracles:['LICENSE']}]};}
function fixture(){
  const generated=generateWorkflowContract(input());const {manifest,manifestHash}=generated;
  const seal=(r:Omit<WorkflowCompletion,'receiptHash'>):WorkflowCompletion=>({...r,receiptHash:resolutionDigest(r)});
  const first=seal({version:1,workflowId:manifest.workflowId,manifestHash,checkpointId:'LEGAL',actor:addr,artifactHash:digest,completedAt:2000,sequence:1,dependencies:[],
    oracles:[{id:'LICENSE',contractAddress:addr,specHash:digest,outcomeId:'PERMITTED',evidenceDigest:digest,observedAt:1900}]});
  const {receiptHash:old,...body}=first;
  const second=seal({...body,checkpointId:'RELEASE',sequence:2,completedAt:2010,dependencies:[{checkpointId:'LEGAL',receiptHash:first.receiptHash}]});
  return {...generated,first,second,seal};
}
test('workflow generation pins immutable policy and concrete GenVM runner',()=>{
  assert.throws(()=>normalizeWorkflow({...input(),workflowId:['RELEASE-PIPELINE']} as any),/WORKFLOW_ID/);
  const a=generateWorkflowContract(input());const b=input();b.checkpoints.reverse();
  assert.equal(a.source,generateWorkflowContract(b).source);assert.equal(a.manifestHash,resolutionDigest(a.manifest));
  assert.match(a.source,/get_contract_at/);assert.match(a.source,/sender_address/);
  assert.match(a.source,/Depends.*py-genlayer:1jb45/);assert.doesNotMatch(a.source,/exec_prompt|public\.write\s+def set_/);
  // GenVM parses consecutive header comments as one JSON dependency block.
  const header=a.source.split('\n\n')[0].split('\n').map(line=>line.replace(/^#\s?/,'' )).join('\n');
  assert.match(JSON.parse(header).Depends,/^py-genlayer:[a-z0-9]{52}$/);
  a.manifest.checkpoints[0].actor='0x'+'2'.repeat(40) as any;
  assert.equal(generateWorkflowContract(input()).manifest.checkpoints[0].actor,addr);
});
const invalid:Array<[string,(v:any)=>void,string]>=[
  ['version',v=>v.version=2,'VERSION'],['cycle',v=>v.checkpoints[0].requires=['RELEASE'],'CYCLIC'],
  ['missing dependency',v=>v.checkpoints[1].requires=['MISSING'],'UNKNOWN_CHECKPOINT_DEPENDENCY'],
  ['self dependency',v=>v.checkpoints[0].requires=['LEGAL'],'DEPENDENCIES'],
  ['duplicate checkpoint',v=>v.checkpoints.push(v.checkpoints[0]),'DUPLICATE_CHECKPOINT'],
  ['duplicate oracle address',v=>v.oracles.push({...v.oracles[0],id:'OTHER'}),'DUPLICATE_WORKFLOW_ORACLE'],
  ['unknown oracle',v=>v.checkpoints[0].oracles=['MISSING'],'ORACLES'],
  ['no oracle',v=>v.checkpoints[0].oracles=[],'ORACLES'],
  ['bad actor',v=>v.checkpoints[0].actor='0x'+'0'.repeat(40),'IDENTITY'],
  ['bad artifact',v=>v.checkpoints[0].artifactHash='payload','IDENTITY'],
  ['float confidence',v=>v.oracles[0].minimumConfidenceBps=9.5,'POLICY'],
  ['unresolved allowed',v=>v.oracles[0].allowedOutcomes=['UNRESOLVED'],'OUTCOMES'],
  ['stale policy',v=>v.oracles[0].maxAgeSeconds=0,'POLICY'],
  ['python injection',v=>v.className='Gate: pass\nexec(1)','CLASS'],
];
for(const [name,mutate,error]of invalid)test(`manifest rejects ${name}`,()=>{const v=input();mutate(v);assert.throws(()=>generateWorkflowContract(v),new RegExp(error));});
test('offline receipt and dependency audits explicitly do not authenticate chain state',()=>{
  const f=fixture();assert.equal(auditWorkflowCompletion(f.manifest,f.first).finality,'CLAIMED_ONLY');
  assert.equal(auditWorkflowChain(f.manifest,[f.second,f.first]).checkpoints,2);
  assert.throws(()=>auditWorkflowChain(f.manifest,[f.second]),/DEPENDENCY/);
  assert.throws(()=>auditWorkflowChain(f.manifest,[f.first,f.first]),/DUPLICATE/);
});
for(const [name,mutate,error]of [
  ['actor',(r:any)=>r.actor='0x'+'2'.repeat(40),'EFFECT'],
  ['artifact',(r:any)=>r.artifactHash='0x'+'b'.repeat(64),'EFFECT'],
  ['outcome',(r:any)=>r.oracles[0].outcomeId='RESTRICTED','POLICY'],
  ['spec',(r:any)=>r.oracles[0].specHash='0x'+'b'.repeat(64),'POLICY'],
  ['time',(r:any)=>r.completedAt=190000,'POLICY'],
  ['future',(r:any)=>r.oracles[0].observedAt=2001,'POLICY'],
  ['dependency',(r:any)=>r.dependencies=[{checkpointId:'FAKE',receiptHash:digest}],'DEPENDENCIES'],
]as const)test(`rehashed receipt rejects substituted ${name}`,()=>{const f=fixture();const {receiptHash,...r}=structuredClone(f.first);mutate(r);assert.throws(()=>auditWorkflowCompletion(f.manifest,f.seal(r)),new RegExp(error));});
test('chain audit rejects broken hash links and backward sequence',()=>{
  const f=fixture();const {receiptHash,...r}=f.second;r.dependencies[0].receiptHash=digest;
  assert.throws(()=>auditWorkflowChain(f.manifest,[f.first,f.seal(r)]),/DEPENDENCY/);
  r.dependencies[0].receiptHash=f.first.receiptHash;r.sequence=1;
  assert.throws(()=>auditWorkflowChain(f.manifest,[f.first,f.seal(r)]),/DUPLICATE/);
});
test('workflow client reads finalized state, pins manifest and creates signer-owned zero-value request',async()=>{
  const f=fixture();const calls:any[]=[];let chain=61997;let manifest:any=f.manifest;let receipt=f.first;
  const reader={async getChainId(){return chain;},async readContract(q:any){calls.push(q);return JSON.stringify(q.functionName==='get_manifest'?manifest:q.functionName==='get_completion'?receipt:{checkpointId:'LEGAL',manifestHash:f.manifestHash,status:'READY',blockers:[]});}};
  const config={reader,chainId:61997,contractAddress:addr,expectedManifest:f.manifest};
  const c=createWorkflowClient(config);config.chainId=1;config.contractAddress=`0x${'2'.repeat(40)}` as typeof addr;
  assert.equal((await c.preview('LEGAL')).advisory,true);assert.equal((await c.completion('LEGAL')).value.receiptHash,f.first.receiptHash);
  assert.ok(calls.every(q=>q.transactionHashVariant===TransactionHashVariant.LATEST_FINAL));
  assert.deepEqual(c.completeRequest('LEGAL'),{address:addr,functionName:'complete',args:['LEGAL'],value:0n});
  receipt=f.second;await assert.rejects(c.completion('LEGAL'),/CHECKPOINT_MISMATCH/);
  manifest={...f.manifest,workflowId:'OTHER'};await assert.rejects(c.preview('LEGAL'),/MANIFEST_MISMATCH/);
  chain=1;await assert.rejects(c.preview('LEGAL'),/CHAIN_MISMATCH/);
  assert.throws(()=>c.completeRequest('MISSING'),/UNKNOWN/);
});
test('client rejects contradictory preview and sanitizes RPC errors',async()=>{
  const f=fixture();let fail=false;
  const c=createWorkflowClient({chainId:61997,contractAddress:addr,expectedManifest:f.manifest,reader:{async getChainId(){return 61997;},async readContract(q){
    if(fail)throw Error('secret-provider-token');return q.functionName==='get_manifest'?f.manifest:{checkpointId:'LEGAL',manifestHash:f.manifestHash,status:'READY',blockers:['ORACLE:LICENSE']};}}});
  await assert.rejects(c.preview('LEGAL'),/BLOCKERS/);fail=true;await assert.rejects(c.preview('LEGAL'),/^Error: WORKFLOW_RPC_READ_FAILED$/);
});
test('CLI generates without overwriting and audits a dependency closure',async()=>{
  const root=await mkdtemp(join(tmpdir(),'gavel-workflow-'));const f=fixture();
  try{await writeFile(join(root,'manifest.json'),JSON.stringify(f.manifest));await writeFile(join(root,'receipts.json'),JSON.stringify([f.first,f.second]));
    const run=(...args:string[])=>spawnSync(process.execPath,['bin/gavel.mjs',...args],{encoding:'utf8'});
    assert.equal(run('generate-workflow',join(root,'manifest.json'),join(root,'gate.py')).status,0);
    assert.equal(run('generate-workflow',join(root,'manifest.json'),join(root,'gate.py')).status,1);
    const audit=run('audit-workflow',join(root,'manifest.json'),join(root,'receipts.json'));assert.equal(audit.status,0,audit.stderr);assert.equal(JSON.parse(audit.stdout).finality,'CLAIMED_ONLY');
  }finally{await rm(root,{recursive:true,force:true});}
});
