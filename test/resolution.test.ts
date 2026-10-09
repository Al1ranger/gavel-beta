import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TransactionHashVariant } from 'genlayer-js/types';
import { gavelDeliveryProofContract, resolutionDigest, canonicalResolutionJson, sealResolutionBundle,
  auditResolutionBundle, createResolutionExecutor, createMemoryActionStore, createFileActionStore, readResolutionBundle } from '../dist/index.js';
import type { ResolutionBundle, ResolutionPolicy, ResolutionReader, ResolutionActionStore } from '../dist/resolution.js';

const address = `0x${'1'.repeat(40)}` as const;
const txHash = `0x${'2'.repeat(64)}` as const;
const compiled = gavelDeliveryProofContract().compiledSpec;
function fixture() {
  const spec = structuredClone(compiled);
  const evidence = (spec.approvedSources as string[]).map(source => ({source, available:true, content:'SDK installation and GenLayer deployment documented. 日本語 😀', error:''}));
  const verdict = {marketId:spec.marketId, specHash:resolutionDigest(spec), evidenceDigest:resolutionDigest(evidence), evidence,
    observedAt:2_000_000_000, status:'RESOLVED', winnerIndex:0, outcomeId:'VERIFIED', attempt:1, confidenceBps:9500,
    facts:[{claim:'SDK delivered',source:evidence[0].source,supportsOutcome:'VERIFIED',quote:'GenLayer deployment'}],
    rulesApplied:(spec.resolutionRules as string[]).map(rule => ({rule,satisfied:true,explanation:'checked'})),
    featuresApplied:(spec.features as any[]).map(feature => ({feature:feature.id,satisfied:true,explanation:'checked'})),
    conflicts:[],reasonCode:'SUPPORTED',reasoningSummary:'Verified delivery'};
  const bundle = sealResolutionBundle({version:1,chainId:61997,contractAddress:address,transactionHash:txHash,spec,verdict,
    receipt:{transactionHash:txHash,contractAddress:address,status:'FINALIZED',execution:'FINISHED_WITH_RETURN',consensus:'MAJORITY_AGREE',leaderOnly:false,functionName:'resolve',args:[]}} as any);
  const policy:ResolutionPolicy = {chainId:61997,contractAddress:address,expectedSpecHash:verdict.specHash,
    minimumConfidenceBps:9000,minimumSources:1,maxAgeSeconds:3600,now:2_000_000_100,allowedOutcomes:['VERIFIED']};
  const calls:any[] = [];
  const reader:ResolutionReader = {
    async getChainId() { return 61997; },
    async readContract(request) { calls.push(request); return JSON.stringify(request.functionName === 'get_spec' ? bundle.spec : bundle.verdict); },
    async getTransaction() { return {hash:txHash,to_address:address,statusName:bundle.receipt.status,
      txExecutionResultName:bundle.receipt.execution,result_name:bundle.receipt.consensus,leader_only:bundle.receipt.leaderOnly,
      data:{calldata:{readable:'{"":"resolve","args":[],}'}},consensus_data:{leader_receipt:[{mode:'leader',execution_result:'SUCCESS'}]}}; },
  };
  return {bundle,policy,reader,calls};
}
const reseal = (b:ResolutionBundle) => { const {bundleHash,...input} = b; return sealResolutionBundle(input); };
test('canonical JSON matches Python for nested Unicode and numeric object keys', () => {
  const value = {'10':'😀','2':'é','\ue000':'x','😀':'y',nested:[true,null,{'z':2,'a':'\n'}]};
  const expected = '{"10":"\\ud83d\\ude00","2":"\\u00e9","nested":[true,null,{"a":"\\n","z":2}],"\\ue000":"x","\\ud83d\\ude00":"y"}';
  assert.equal(canonicalResolutionJson(value), expected);
  assert.throws(() => canonicalResolutionJson({float:1.1}), /INTEGER/);
  assert.throws(() => canonicalResolutionJson({n:Number.MAX_SAFE_INTEGER+1}), /INTEGER/);
  assert.throws(() => canonicalResolutionJson(new Date()), /OBJECT/);
  const cyclic:any = {}; cyclic.self = cyclic;
  assert.throws(() => canonicalResolutionJson(cyclic), /JSON/);
});
test('valid offline bundle checks integrity but never claims chain authentication', () => {
  const {bundle,policy} = fixture(); const result = auditResolutionBundle(bundle,policy);
  assert.equal(result.integrity,'VERIFIED'); assert.equal(result.finality,'CLAIMED_ONLY');
});
const mutations:Array<[string,(b:any,p:any)=>void,string]> = [
  ['provisional',b=>b.receipt.status='ACCEPTED','FINALIZED'],
  ['execution error',b=>b.receipt.execution='ERROR','FINALIZED'],
  ['leader only',b=>b.receipt.leaderOnly=true,'FINALIZED'],
  ['no consensus',b=>b.receipt.consensus='MAJORITY_DISAGREE','FINALIZED'],
  ['other contract',b=>b.contractAddress='0x'+'3'.repeat(40),'DEPLOYMENT'],
  ['other chain',b=>b.chainId=61999,'DEPLOYMENT'],
  ['other receipt',b=>b.receipt.transactionHash='0x'+'3'.repeat(64),'BINDING'],
  ['other function',b=>b.receipt.functionName='get_verdict','CALL'],
  ['nonempty arguments',b=>b.receipt.args=[1],'CALL'],
  ['wrong spec',b=>b.spec.question='tampered','SPEC'],
  ['wrong market',b=>b.verdict.marketId='OTHER','MARKET'],
  ['unresolved',b=>b.verdict.status='UNRESOLVED','UNRESOLVED'],
  ['wrong winner',b=>b.verdict.winnerIndex=1,'OUTCOME'],
  ['disallowed outcome',(_b,p)=>p.allowedOutcomes=['NOT_VERIFIED'],'OUTCOME'],
  ['low confidence',b=>b.verdict.confidenceBps=8999,'CONFIDENCE'],
  ['stale',(_b,p)=>p.now+=4000,'STALE'],
  ['future',b=>b.verdict.observedAt+=1000,'FUTURE'],
  ['false mandatory rule',b=>b.verdict.rulesApplied[0].satisfied=false,'RULE'],
  ['missing rule',b=>b.verdict.rulesApplied.pop(),'RULE'],
  ['duplicate rule',b=>b.verdict.rulesApplied[1]=b.verdict.rulesApplied[0],'RULE'],
  ['false feature',b=>b.verdict.featuresApplied[0].satisfied=false,'FEATURE'],
  ['missing feature',b=>b.verdict.featuresApplied=[],'FEATURE'],
  ['conflict',b=>b.verdict.conflicts=[{description:'conflict',sources:[]}],'CONFLICT'],
  ['modified evidence',b=>b.verdict.evidence[0].content+='changed','DIGEST'],
  ['unapproved source',b=>b.verdict.evidence[0].source='https://attacker.example/data','EVIDENCE'],
  ['unavailable evidence',b=>{b.verdict.evidence[0]={...b.verdict.evidence[0],available:false,content:'',error:'UNAVAILABLE'};b.verdict.evidenceDigest=resolutionDigest(b.verdict.evidence);},'SOURCES'],
  ['invented quote',b=>b.verdict.facts[0].quote='not present','QUOTE'],
  ['invalid clock',(_b,p)=>p.now=0,'POLICY'],
];
for (const [label,mutate,code] of mutations) test(`audit rejects ${label}`, () => {
  const {bundle,policy} = fixture(); mutate(bundle,policy);
  assert.throws(() => auditResolutionBundle(reseal(bundle),policy), new RegExp(code));
});
test('editing even a non-policy field breaks the export commitment', () => {
  const {bundle,policy} = fixture(); bundle.verdict.reasoningSummary='changed';
  assert.throws(() => auditResolutionBundle(bundle,policy), /BUNDLE_HASH/);
});
test('trusted acquisition requests finalized state and verifies receipt identity', async () => {
  const {reader,policy,calls} = fixture(); const b = await readResolutionBundle(reader,policy,txHash);
  assert.equal(b.verdict.outcomeId,'VERIFIED');
  assert.equal(calls.length,2); assert.ok(calls.every(c=>c.transactionHashVariant===TransactionHashVariant.LATEST_FINAL));
  await assert.rejects(readResolutionBundle({...reader,getChainId:async()=>61999},policy,txHash),/RPC_CHAIN/);
  const receipt:any = await reader.getTransaction({hash:txHash}); receipt.hash='0x'+'4'.repeat(64);
  await assert.rejects(readResolutionBundle({...reader,getTransaction:async()=>receipt},policy,txHash),/HASH_MISMATCH/);
  receipt.hash=txHash; receipt.consensus_data.leader_receipt[0].execution_result='ERROR';
  await assert.rejects(readResolutionBundle({...reader,getTransaction:async()=>receipt},policy,txHash),/LEADER_EXECUTION/);
});

test('real zero-argument receipt encoding omits args; keyword and extra fields are refused', async () => {
  const {reader,policy} = fixture();
  const receipt:any = await reader.getTransaction({hash:txHash});
  receipt.data.calldata.readable = '{"":"resolve"}';
  const actual = {...reader,getTransaction:async()=>receipt};
  const bundle = await readResolutionBundle(actual,policy,txHash);
  assert.deepEqual(bundle.receipt.args,[]);
  receipt.data.calldata.readable = '{"":"resolve","kwargs":{"other":true}}';
  await assert.rejects(readResolutionBundle(actual,policy,txHash),/INVALID_CALLDATA/);
});
test('calldata text is data and cannot authorize a different call', async () => {
  const {reader,policy} = fixture(); const receipt:any = await reader.getTransaction({hash:txHash});
  for (const readable of ['{"":"resolve","args":[1,]}','{"":"observe","args":[],}','__import__("os")','{"":"resolve","args":[],"context":"comma,] inside string"}']) {
    receipt.data.calldata.readable=readable;
    await assert.rejects(readResolutionBundle({...reader,getTransaction:async()=>receipt},policy,txHash));
  }
});
async function exerciseStore(store:ResolutionActionStore) {
  const {reader,policy} = fixture(); const executor=createResolutionExecutor({reader,store}); let effects=0;
  let release!:()=>void; const pending = new Promise<void>(resolve=>{release=resolve;});
  const options={policy,transactionHash:txHash,action:{name:'release-work',input:{jobId:'delivery-1'}},
    apply:async()=>{ effects++; await pending; return 'job:delivery-1:released'; }};
  const first=executor.execute(options);
  while(effects===0) await new Promise(resolve=>setTimeout(resolve,5));
  await assert.rejects(executor.execute(options),/RECONCILIATION/);
  release(); assert.equal((await first).status,'COMPLETED');
  assert.equal((await executor.execute(options)).status,'ALREADY_COMPLETED'); assert.equal(effects,1);
  await assert.rejects(executor.execute({...options,action:{...options.action,input:{jobId:'other'}}}),/ACTION_CONFLICT/);
}
test('memory store serializes racing consumers and rejects conflicting replay',()=>exerciseStore(createMemoryActionStore()));
test('file reservations survive store recreation and concurrent consumers',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'gavel-action-'));
  try { await exerciseStore(createFileActionStore(directory));
    const {reader,policy}=fixture(); let effects=0;
    const executor=createResolutionExecutor({reader,store:createFileActionStore(directory)});
    const result=await executor.execute({policy,transactionHash:txHash,action:{name:'release-work',input:{jobId:'delivery-1'}},apply:async()=>{effects++;return 'duplicate';}});
    assert.equal(result.status,'ALREADY_COMPLETED'); assert.equal(effects,0);
  } finally {await rm(directory,{recursive:true,force:true});}
});
test('failed or ambiguous downstream actions never retry automatically',async()=>{
  const {reader,policy}=fixture(); const store=createMemoryActionStore(); const executor=createResolutionExecutor({reader,store}); let effects=0;
  const options={policy,transactionHash:txHash,action:{name:'release-work',input:{}},apply:async()=>{effects++;throw new Error('secret provider response');}};
  for(let i=0;i<2;i++) await assert.rejects(executor.execute(options),/^ResolutionError: ACTION_RECONCILIATION_REQUIRED$/);
  assert.equal(effects,1);
});
test('fresh RPC policy failures never reserve or apply an action',async()=>{
  const {reader,policy,bundle}=fixture(); bundle.verdict.rulesApplied[0].satisfied=false;
  let claimed=false; const store=createMemoryActionStore(); const original=store.claim;
  store.claim=async record=>{claimed=true;return original(record);};
  const executor=createResolutionExecutor({reader,store}); let effects=0;
  await assert.rejects(executor.execute({policy,transactionHash:txHash,action:{name:'release-work',input:{}},apply:async()=>{effects++;return 'bad';}}),/RULE/);
  assert.equal(claimed,false);assert.equal(effects,0);
});
test('an interrupted persistence write requires reconciliation without replay',async()=>{
  const {reader,policy}=fixture();const store=createMemoryActionStore();store.complete=async()=>{throw new Error('disk full');};
  const executor=createResolutionExecutor({reader,store});let effects=0;
  const options={policy,transactionHash:txHash,action:{name:'release-work',input:{}},apply:async()=>{effects++;return 'done';}};
  await assert.rejects(executor.execute(options),/RECONCILIATION/);await assert.rejects(executor.execute(options),/RECONCILIATION/);assert.equal(effects,1);
});

test('action handlers cannot change the returned audit export',async()=>{
  const {reader,policy}=fixture();
  const executor=createResolutionExecutor({reader,store:createMemoryActionStore()});
  const result=await executor.execute({policy,transactionHash:txHash,action:{name:'release-work',input:{}},
    apply:async({bundle})=>{bundle.verdict.outcomeId='MUTATED';return 'done';}});
  assert.equal(result.bundle.verdict.outcomeId,'VERIFIED');
  assert.equal(auditResolutionBundle(result.bundle,policy).policy,'ELIGIBLE');
});

test('provider and malformed contract payloads never leak through acquisition errors',async()=>{
  const {reader,policy}=fixture();
  const secret=Object.assign(new Error('private provider token'),{payload:{credentials:'secret'}});
  for(const failing of [{...reader,getChainId:async()=>{throw secret;}},
    {...reader,getTransaction:async()=>{throw secret;}}]) {
    await assert.rejects(readResolutionBundle(failing,policy,txHash),error=>{
      assert.equal(String(error),'ResolutionError: RPC_READ_FAILED');
      assert.equal((error as any).cause,undefined);return true;
    });
  }
  await assert.rejects(readResolutionBundle({...reader,readContract:async()=>'<private invalid response>'},policy,txHash),/^ResolutionError: INVALID_CONTRACT_JSON$/);
});

test('CLI audit succeeds offline and refuses a resealed ineligible verdict',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'gavel-cli-audit-'));
  try {
    const {bundle,policy}=fixture();const bundleFile=join(directory,'bundle.json');const policyFile=join(directory,'policy.json');
    await writeFile(bundleFile,JSON.stringify(bundle));await writeFile(policyFile,JSON.stringify(policy));
    const cli=new URL('../bin/gavel.mjs',import.meta.url);
    const run=()=>spawnSync(process.execPath,[fileURLToPath(cli),'audit-resolution',bundleFile,policyFile],{encoding:'utf8'});
    const accepted=run();assert.equal(accepted.status,0,accepted.stderr);
    assert.equal(JSON.parse(accepted.stdout).finality,'CLAIMED_ONLY');
    bundle.verdict.rulesApplied[0].satisfied=false;await writeFile(bundleFile,JSON.stringify(reseal(bundle)));
    const refused=run();assert.equal(refused.status,1);
    assert.match(refused.stderr,/MANDATORY_RULE_UNSATISFIED/);
  } finally {await rm(directory,{recursive:true,force:true});}
});
