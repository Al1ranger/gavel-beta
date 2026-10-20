import { canonicalResolutionJson, resolutionDigest, resolutionCheck } from './resolutionAudit.ts';
import { workflowRuntime } from './workflowRuntime.ts';
import { TransactionHashVariant } from 'genlayer-js/types';

export type WorkflowOracle = {
  id: string; contractAddress: `0x${string}`; expectedSpecHash: `0x${string}`;
  marketId: string; allowedOutcomes: string[]; minimumConfidenceBps: number;
  minimumSources: number; maxAgeSeconds: number;
};
export type WorkflowCheckpoint = {
  id: string; actor: `0x${string}`; artifactHash: `0x${string}`;
  requires: string[]; oracles: string[];
};
export type WorkflowInput = {workflowId:string; oracles:WorkflowOracle[]; checkpoints:WorkflowCheckpoint[]; className?:string};
export type WorkflowManifest = {version:1; workflowId:string; oracles:WorkflowOracle[]; checkpoints:WorkflowCheckpoint[]};
const identifier = {test:(v:unknown)=>typeof v==='string' && /^[A-Z][A-Z0-9_-]{2,63}$/.test(v)};
const address = {test:(v:unknown)=>typeof v==='string' && /^0x[0-9a-f]{40}$/i.test(v)};
const hash = {test:(v:unknown)=>typeof v==='string' && /^0x[0-9a-f]{64}$/.test(v)};
const unique = (values:string[]) => new Set(values).size === values.length;

export function normalizeWorkflow(input:WorkflowInput): WorkflowManifest {
  resolutionCheck(!input || !('version' in input) || input.version===1, 'INVALID_WORKFLOW_VERSION');
  resolutionCheck(input && identifier.test(input.workflowId), 'INVALID_WORKFLOW_ID');
  resolutionCheck(Array.isArray(input.oracles) && input.oracles.length >= 1 && input.oracles.length <= 8, 'INVALID_WORKFLOW_ORACLES');
  const oracles = input.oracles.map(o => {
    resolutionCheck(o && identifier.test(o.id) && address.test(o.contractAddress) && !/^0x0{40}$/i.test(o.contractAddress)
      && hash.test(o.expectedSpecHash) && identifier.test(o.marketId), 'INVALID_ORACLE_IDENTITY');
    resolutionCheck(Array.isArray(o.allowedOutcomes) && o.allowedOutcomes.length > 0 && o.allowedOutcomes.length <= 16
      && unique(o.allowedOutcomes) && o.allowedOutcomes.every(id => identifier.test(id) && id !== 'UNRESOLVED'), 'INVALID_ORACLE_OUTCOMES');
    resolutionCheck(Number.isSafeInteger(o.minimumConfidenceBps) && o.minimumConfidenceBps >= 0 && o.minimumConfidenceBps <= 10000
      && Number.isSafeInteger(o.minimumSources) && o.minimumSources >= 1 && o.minimumSources <= 8
      && Number.isSafeInteger(o.maxAgeSeconds) && o.maxAgeSeconds > 0 && o.maxAgeSeconds <= 366*86400, 'INVALID_ORACLE_POLICY');
    return {id:o.id,contractAddress:o.contractAddress.toLowerCase() as `0x${string}`,expectedSpecHash:o.expectedSpecHash,marketId:o.marketId,
      allowedOutcomes:[...o.allowedOutcomes].sort(),minimumConfidenceBps:o.minimumConfidenceBps,minimumSources:o.minimumSources,maxAgeSeconds:o.maxAgeSeconds};
  }).sort((a,b)=>a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  resolutionCheck(unique(oracles.map(o=>o.id)) && unique(oracles.map(o=>o.contractAddress)), 'DUPLICATE_WORKFLOW_ORACLE');
  resolutionCheck(Array.isArray(input.checkpoints) && input.checkpoints.length >= 1 && input.checkpoints.length <= 16, 'INVALID_CHECKPOINTS');
  const checkpoints = input.checkpoints.map(c => {
    resolutionCheck(c && identifier.test(c.id) && address.test(c.actor) && !/^0x0{40}$/i.test(c.actor) && hash.test(c.artifactHash), 'INVALID_CHECKPOINT_IDENTITY');
    resolutionCheck(Array.isArray(c.requires) && c.requires.length <= 15 && unique(c.requires)
      && c.requires.every(id=>identifier.test(id) && id !== c.id), 'INVALID_CHECKPOINT_DEPENDENCIES');
    resolutionCheck(Array.isArray(c.oracles) && c.oracles.length >= 1 && c.oracles.length <= 8 && unique(c.oracles)
      && c.oracles.every(id=>oracles.some(o=>o.id===id)), 'INVALID_CHECKPOINT_ORACLES');
    return {id:c.id,actor:c.actor.toLowerCase() as `0x${string}`,artifactHash:c.artifactHash,requires:[...c.requires].sort(),oracles:[...c.oracles].sort()};
  }).sort((a,b)=>a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  resolutionCheck(unique(checkpoints.map(c=>c.id)), 'DUPLICATE_CHECKPOINT');
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (id:string) => {
    resolutionCheck(!visiting.has(id), 'CYCLIC_WORKFLOW');
    if (visited.has(id)) return;
    const checkpoint = checkpoints.find(c=>c.id===id);
    resolutionCheck(checkpoint, 'UNKNOWN_CHECKPOINT_DEPENDENCY');
    visiting.add(id); checkpoint.requires.forEach(visit); visiting.delete(id); visited.add(id);
  };
  checkpoints.forEach(c=>visit(c.id));
  resolutionCheck(oracles.every(o=>checkpoints.some(c=>c.oracles.includes(o.id))), 'UNUSED_WORKFLOW_ORACLE');
  return JSON.parse(canonicalResolutionJson({version:1,workflowId:input.workflowId,oracles,checkpoints}));
}

/** Immutable, actor-bound DAG. No submitted verdict, arbitrary payload or admin override. */
export function generateWorkflowContract(input:WorkflowInput) {
  const manifest = normalizeWorkflow(input);
  const className = input.className ?? 'GavelWorkflowGate';
  resolutionCheck(typeof className==='string' && /^[A-Z][A-Za-z0-9]{2,63}$/.test(className), 'INVALID_WORKFLOW_CLASS');
  const manifestHash = resolutionDigest(manifest);
  const literal = JSON.stringify(canonicalResolutionJson(manifest));
  const source = `# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }\n\n# Generated by gavel-judgment-sdk. Immutable workflow policy.\nfrom genlayer import *\nimport json\nimport hashlib\n\nMANIFEST_JSON = ${literal}\nMANIFEST_HASH = "${manifestHash}"\n${workflowRuntime.replace('__WORKFLOW_CLASS__',className)}`;
  return {className,source,manifest,manifestHash};
}

export type WorkflowReader = {
  getChainId():Promise<number|string>;
  readContract(request:{address:`0x${string}`;functionName:string;args:string[];transactionHashVariant:TransactionHashVariant}):Promise<unknown>;
};
export type WorkflowPreview = {checkpointId:string;status:'READY'|'BLOCKED'|'COMPLETED';blockers:string[];manifestHash:`0x${string}`;receipt?:WorkflowCompletion};
export type WorkflowCompletion = {version:1;workflowId:string;manifestHash:`0x${string}`;checkpointId:string;actor:`0x${string}`;
  artifactHash:`0x${string}`;completedAt:number;sequence:number;dependencies:Array<{checkpointId:string;receiptHash:`0x${string}`}>;
  oracles:Array<{id:string;contractAddress:`0x${string}`;specHash:`0x${string}`;outcomeId:string;evidenceDigest:`0x${string}`;observedAt:number}>;receiptHash:`0x${string}`};

/** Checks self-consistency against a pinned manifest, not chain authenticity. */
export function auditWorkflowCompletion(manifest:WorkflowManifest, receipt:WorkflowCompletion) {
  const normalized = normalizeWorkflow(manifest);
  resolutionCheck(receipt && receipt.version===1 && receipt.workflowId===normalized.workflowId
    && receipt.manifestHash===resolutionDigest(normalized), 'WORKFLOW_RECEIPT_IDENTITY');
  const {receiptHash,...fields}=receipt;
  resolutionCheck(resolutionDigest(fields)===receiptHash, 'WORKFLOW_RECEIPT_HASH');
  const checkpoint=normalized.checkpoints.find(c=>c.id===receipt.checkpointId);
  resolutionCheck(checkpoint && receipt.actor===checkpoint.actor && receipt.artifactHash===checkpoint.artifactHash, 'WORKFLOW_RECEIPT_EFFECT');
  resolutionCheck(Number.isSafeInteger(receipt.completedAt) && receipt.completedAt>0 && Number.isSafeInteger(receipt.sequence)
    && receipt.sequence>=1 && receipt.sequence<=normalized.checkpoints.length, 'WORKFLOW_RECEIPT_TIME');
  resolutionCheck(Array.isArray(receipt.dependencies) && canonicalResolutionJson(receipt.dependencies.map(d=>d.checkpointId))===canonicalResolutionJson(checkpoint.requires)
    && receipt.dependencies.every(d=>hash.test(d.receiptHash)), 'WORKFLOW_RECEIPT_DEPENDENCIES');
  resolutionCheck(Array.isArray(receipt.oracles) && canonicalResolutionJson(receipt.oracles.map(o=>o.id))===canonicalResolutionJson(checkpoint.oracles), 'WORKFLOW_RECEIPT_ORACLES');
  for(const result of receipt.oracles){
    const oracle=normalized.oracles.find(o=>o.id===result.id)!;
    resolutionCheck(result.contractAddress===oracle.contractAddress && result.specHash===oracle.expectedSpecHash && oracle.allowedOutcomes.includes(result.outcomeId)
      && hash.test(result.evidenceDigest) && Number.isSafeInteger(result.observedAt) && result.observedAt>0
      && result.observedAt<=receipt.completedAt && receipt.completedAt-result.observedAt<=oracle.maxAgeSeconds, 'WORKFLOW_RECEIPT_ORACLE_POLICY');
  }
  return {integrity:'VERIFIED' as const,finality:'CLAIMED_ONLY' as const,workflowId:receipt.workflowId,checkpointId:receipt.checkpointId,receiptHash};
}

/** Verify a complete dependency closure. Hash consistency is not chain authentication. */
export function auditWorkflowChain(manifest:WorkflowManifest, receipts:WorkflowCompletion[]) {
  resolutionCheck(Array.isArray(receipts) && receipts.length>0 && receipts.length<=manifest.checkpoints.length, 'INVALID_WORKFLOW_CHAIN');
  receipts.forEach(r=>auditWorkflowCompletion(manifest,r));
  resolutionCheck(unique(receipts.map(r=>r.checkpointId)) && new Set(receipts.map(r=>r.sequence)).size===receipts.length, 'DUPLICATE_WORKFLOW_RECEIPT');
  for(const receipt of receipts)for(const dependency of receipt.dependencies){
    const prior=receipts.find(r=>r.checkpointId===dependency.checkpointId);
    resolutionCheck(prior && prior.receiptHash===dependency.receiptHash && prior.sequence<receipt.sequence
      && prior.completedAt<=receipt.completedAt, 'WORKFLOW_DEPENDENCY_RECEIPT_MISMATCH');
  }
  return {integrity:'VERIFIED' as const,finality:'CLAIMED_ONLY' as const,checkpoints:receipts.length};
}

export function createWorkflowClient(config:{reader:WorkflowReader;chainId:number;contractAddress:`0x${string}`;expectedManifest:WorkflowManifest}) {
  const {reader,chainId,contractAddress}=config;
  const manifest=normalizeWorkflow(config.expectedManifest);const manifestHash=resolutionDigest(manifest);
  resolutionCheck(Number.isSafeInteger(chainId) && chainId>0 && address.test(contractAddress), 'INVALID_WORKFLOW_DEPLOYMENT');
  async function read(functionName:string,args:string[]){
    let raw:unknown;
    try {
      resolutionCheck(Number(await reader.getChainId())===chainId,'WORKFLOW_CHAIN_MISMATCH');
      raw=await reader.readContract({address:contractAddress,functionName,args,transactionHashVariant:TransactionHashVariant.LATEST_FINAL});
    }catch(error){if((error as {code?:string}).code==='WORKFLOW_CHAIN_MISMATCH')throw error;throw new Error('WORKFLOW_RPC_READ_FAILED');}
    try{return typeof raw==='string'?JSON.parse(raw):raw;}catch{throw new Error('WORKFLOW_INVALID_JSON');}
  }
  async function verifyManifest(){resolutionCheck(resolutionDigest(await read('get_manifest',[]))===manifestHash,'WORKFLOW_MANIFEST_MISMATCH');}
  return {
    manifest:JSON.parse(canonicalResolutionJson(manifest)) as WorkflowManifest,
    async preview(checkpointId:string){
      resolutionCheck(manifest.checkpoints.some(c=>c.id===checkpointId),'UNKNOWN_CHECKPOINT');await verifyManifest();
      const result=await read('preview',[checkpointId]) as WorkflowPreview;
      resolutionCheck(result && result.checkpointId===checkpointId && result.manifestHash===manifestHash
        && ['READY','BLOCKED','COMPLETED'].includes(result.status) && Array.isArray(result.blockers)
        && result.blockers.every(b=>typeof b==='string'), 'INVALID_WORKFLOW_PREVIEW');
      resolutionCheck(result.status==='BLOCKED'?result.blockers.length>0:result.blockers.length===0,'INVALID_WORKFLOW_BLOCKERS');
      if(result.status==='COMPLETED'){resolutionCheck(result.receipt,'WORKFLOW_RECEIPT_MISSING');auditWorkflowCompletion(manifest,result.receipt);
        resolutionCheck(result.receipt.checkpointId===checkpointId,'WORKFLOW_CHECKPOINT_MISMATCH');}
      else resolutionCheck(result.receipt===undefined,'UNEXPECTED_WORKFLOW_RECEIPT');
      return {value:result,state:'FINALIZED_STATE' as const,advisory:true as const};
    },
    async completion(checkpointId:string){
      resolutionCheck(manifest.checkpoints.some(c=>c.id===checkpointId),'UNKNOWN_CHECKPOINT');await verifyManifest();
      const result=await read('get_completion',[checkpointId]) as WorkflowCompletion;
      auditWorkflowCompletion(manifest,result);resolutionCheck(result.checkpointId===checkpointId,'WORKFLOW_CHECKPOINT_MISMATCH');
      return {value:result,state:'FINALIZED_STATE' as const};
    },
    completeRequest(checkpointId:string){resolutionCheck(manifest.checkpoints.some(c=>c.id===checkpointId),'UNKNOWN_CHECKPOINT');
      return {address:contractAddress,functionName:'complete',args:[checkpointId],value:0n};},
  };
}
