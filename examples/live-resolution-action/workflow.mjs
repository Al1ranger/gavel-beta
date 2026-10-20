// Explicit write integration demo on Studio Next, using faucet-only test GEN.
// npm ci in this directory first. Ephemeral signers remain in memory only.
import {createAccount,createClient} from 'genlayer-js';
import {studioDevnet} from 'genlayer-js/chains';
import {TransactionHashVariant} from 'genlayer-js/types';
import {getAddress} from 'viem';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {generateIntelligentContract} from '../../dist/contracts.js';
import {generateWorkflowContract,createWorkflowClient,auditWorkflowChain} from '../../dist/workflow.js';
import {resolutionDigest} from '../../dist/resolution.js';

const output=process.argv[2]??'artifacts/workflow-live';
await mkdir(output,{recursive:true});
const json=(name,value)=>writeFile(`${output}/${name}.json`,JSON.stringify(value,(_,v)=>typeof v==='bigint'?String(v):v,2)+'\n');
const sha=value=>createHash('sha256').update(value).digest('hex');
const actor=createAccount();const stranger=createAccount();
const client=createClient({chain:studioDevnet,account:actor});
const other=createClient({chain:studioDevnet,account:stranger});
assert.equal(Number(await client.getChainId()),61997);
// Dedicated, newly generated accounts. Never funds or signs with a user wallet.
// The SDK fundAccount helper is localnet-only; hosted Studio exposes the same
// public faucet RPC. Chain identity above is checked before requesting test GEN.
for(const address of [actor.address,stranger.address]){
  await client.request({method:'sim_fundAccount',params:[address,10_000_000_000_000_000_000]});
}
const v1=JSON.parse(await readFile(new URL('../../docs/deployments/resolution-actions-studio-next.json',import.meta.url),'utf8'));
const oldCode=await client.getContractCode(v1.address);assert.equal(sha(oldCode),v1.sourceSha256);
const oldSpec=JSON.parse(await client.readContract({address:v1.address,functionName:'get_spec',args:[],transactionHashVariant:TransactionHashVariant.LATEST_FINAL}));
assert.equal(resolutionDigest(oldSpec),v1.specHash);
const sourceUrl=oldSpec.approvedSources[0];
const text=await fetch(sourceUrl).then(r=>{assert.equal(r.status,200);return r.text();});
assert.equal(sha(text),'13cd784a6c31361f0e0c6aa3b410a1cb9a079868b7314c13e3eb8a75351746b9');
const oracle=generateIntelligentContract({className:'GavelWarrantyDisclaimer',spec:{
  marketId:'OPENZEPPELIN-WARRANTY-DISCLAIMER',question:'Does the pinned OpenZeppelin license disclaim warranties and provide the software AS IS?',
  outcomes:[{id:'DISCLAIMED',index:0,label:'Warranties are disclaimed'},{id:'PROVIDED',index:1,label:'Document does not disclaim warranties'}],
  resolutionTime:1757869200,approvedSources:[sourceUrl],resolutionRules:[
    'Select DISCLAIMED if the document explicitly disclaims warranties; otherwise select PROVIDED.',
    'Use an exact contiguous quote from the document. Use the short phrase WITHOUT WARRANTY OF ANY KIND if present. Never paraphrase a quote.',
  ],sourcePolicy:{authority:'OpenZeppelin at immutable commit c64a1ed',corrections:'Only the hash-pinned document; no submitted claims.'}},
  shape:{kind:'BINARY'},evidence:{sources:[{url:sourceUrl,format:'text',sha256:sha(text)}]},minimumConfidenceBps:8500,confidenceToleranceBps:500});
const journal={chainId:61997,actor:actor.address,stranger:stranger.address,transactions:{}};
async function fees(){
  assert.equal(await client.getGasPrice(),0n);
  const estimate=await client.estimateTransactionFees({leaderTimeunitsAllocation:100n,validatorTimeunitsAllocation:200n,rotations:[3n],appealRounds:0n,totalMessageFees:0n});
  assert.ok(estimate.feeValue<=11n*10n**16n,'Fee quote exceeds 0.11 test GEN cap');
  return {distribution:estimate.distribution,feeValue:estimate.feeValue};
}
async function step(name,submit,success=true,expectedError){
  const hash=await submit();journal.transactions[name]=hash;await json('journal',journal);console.log(JSON.stringify({step:name,hash}));
  let receipt;
  // Retry polling the SAME saved hash, never resubmit an ambiguous write.
  for(let attempt=0;attempt<8;attempt++){
    try{receipt=await client.waitForTransactionReceipt({hash,waitUntil:'finalized',fullTransaction:true,retries:120,interval:3000});break;}
    catch{console.log(JSON.stringify({step:name,pollRetry:attempt+1}));}
  }
  assert.ok(receipt,'Polling exhausted; inspect the saved transaction hash');await json(name,receipt);
  assert.equal(receipt.statusName,'FINALIZED');assert.equal(receipt.txExecutionResultName,success?'FINISHED_WITH_RETURN':'FINISHED_WITH_ERROR');
  if(expectedError){
    const failure=JSON.stringify(receipt.consensus_data?.leader_receipt?.map(r=>({result:r.result,stderr:r.genvm_result?.stderr})));
    assert.ok(failure.includes(expectedError),`Unexpected rejection for ${name}`);
  }
  console.log(JSON.stringify({step:name,status:receipt.statusName,execution:receipt.txExecutionResultName}));return receipt;
}
async function deploy(name,source){
  const code='# v0.2.0\n'+source;await writeFile(`${output}/${name}.py`,code);
  const receipt=await step(name,async()=>client.deployContract({code:new Uint8Array(Buffer.from(code)),args:[],fees:await fees()}));
  const address=receipt.data?.contract_address??receipt.txDataDecoded?.contractAddress;
  assert.match(address,/^0x[0-9a-f]{40}$/i);assert.equal(sha(await client.getContractCode(address)),sha(code));
  return {address,sourceSha256:sha(code)};
}
// Optional existing resolver is reusable only when its entire source matches.
const reuse=process.argv[3];
if(reuse)assert.match(reuse,/^0x[0-9a-f]{40}$/i);
const deployedOracle=reuse?{address:getAddress(reuse),sourceSha256:sha('# v0.2.0\n'+oracle.source)}:await deploy('oracleDeployment',oracle.source);
assert.equal(sha(await client.getContractCode(deployedOracle.address)),deployedOracle.sourceSha256);
const generated=generateWorkflowContract({workflowId:'OPENZEPPELIN-RELEASE-GATES',oracles:[
  {id:'LICENSE',contractAddress:v1.address,expectedSpecHash:v1.specHash,marketId:oldSpec.marketId,allowedOutcomes:['PERMITTED'],minimumConfidenceBps:8500,minimumSources:1,maxAgeSeconds:365*86400},
  {id:'WARRANTY',contractAddress:deployedOracle.address,expectedSpecHash:resolutionDigest(oracle.compiledSpec),marketId:oracle.compiledSpec.marketId,allowedOutcomes:['DISCLAIMED'],minimumConfidenceBps:8500,minimumSources:1,maxAgeSeconds:3600},
],checkpoints:[
  {id:'LEGAL',actor:actor.address,artifactHash:`0x${sha(text)}`,requires:[],oracles:['LICENSE']},
  {id:'RELEASE',actor:actor.address,artifactHash:`0x${sha(text)}`,requires:['LEGAL'],oracles:['LICENSE','WARRANTY']},
]});
await json('manifest',generated.manifest);
const gate=await deploy('gateDeployment',generated.source);
const read=createWorkflowClient({reader:client,chainId:61997,contractAddress:gate.address,expectedManifest:generated.manifest});
const write=async(signer,id)=>signer.writeContract({...read.completeRequest(id),fees:await fees()});
assert.equal((await read.preview('RELEASE')).value.status,'BLOCKED');
await step('missingDependency',()=>write(client,'RELEASE'),false,'CHECKPOINT_DEPENDENCY_REQUIRED');
await step('unauthorizedActor',()=>write(other,'LEGAL'),false,'CHECKPOINT_ACTOR_REQUIRED');
await step('legalCompletion',()=>write(client,'LEGAL'));
assert.equal((await read.preview('RELEASE')).value.status,'BLOCKED');
await step('unresolvedOracle',()=>write(client,'RELEASE'),false,'VERDICT_NOT_AVAILABLE');
await step('oracleResolution',async()=>client.writeContract({address:deployedOracle.address,functionName:'resolve',args:[],value:0n,fees:await fees()}));
const oracleVerdict=JSON.parse(await client.readContract({address:deployedOracle.address,functionName:'get_verdict',args:[],transactionHashVariant:TransactionHashVariant.LATEST_FINAL}));
assert.equal(oracleVerdict.status,'RESOLVED');assert.equal(oracleVerdict.outcomeId,'DISCLAIMED');
assert.equal((await read.preview('RELEASE')).value.status,'READY');
await step('releaseCompletion',()=>write(client,'RELEASE'));
const before=(await read.completion('RELEASE')).value;
await step('replayCompletion',()=>write(client,'RELEASE'));
assert.deepEqual((await read.completion('RELEASE')).value,before);
const receipts=[(await read.completion('LEGAL')).value,before];assert.equal(auditWorkflowChain(generated.manifest,receipts).integrity,'VERIFIED');
const progress=await client.readContract({address:gate.address,functionName:'get_progress',args:[],transactionHashVariant:TransactionHashVariant.LATEST_FINAL});assert.equal(progress.completed,2);
await json('completions',receipts);await json('oracle-verdict',oracleVerdict);
await json('proof',{checkedAt:new Date().toISOString(),chainId:61997,rpc:'https://studio-dev.genlayer.com/api',gate,oracle:deployedOracle,
  manifest:generated.manifest,manifestHash:generated.manifestHash,transactions:journal.transactions,progress,receipts,
  controls:{missingDependency:'FINISHED_WITH_ERROR',unauthorizedActor:'FINISHED_WITH_ERROR',unresolvedOracle:'FINISHED_WITH_ERROR',replay:'UNCHANGED_RECEIPT_AND_COUNT'},
  scope:'Onchain checkpoint registry only. No token transfer, software publication or legal certification.'});
console.log(JSON.stringify({gate:gate.address,completed:progress.completed,proof:`${output}/proof.json`}));
