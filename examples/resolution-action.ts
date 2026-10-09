/** Reproducible local integration demo. The RPC and verdict are explicitly synthetic.
 * No wallet, network calls, token transfer, or claimed live consensus.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gavelDeliveryProofContract, resolutionDigest, createResolutionExecutor, createFileActionStore,
  type ResolutionReader, type ResolutionPolicy } from '../dist/index.js';

const directory = resolve(process.argv[2] ?? 'artifacts/resolution-action-demo');
await mkdir(directory,{recursive:true});
const spec=gavelDeliveryProofContract().compiledSpec;
const address=`0x${'1'.repeat(40)}` as const;
const transactionHash=`0x${'2'.repeat(64)}` as const;
const evidence=(spec.approvedSources as string[]).map(source=>({source,available:true,content:'Synthetic fixture: SDK installation, intelligent contracts, GenLayer deployment.',error:''}));
// Fixed clock makes the demo bundle reproducible across repeated runs.
const policy:ResolutionPolicy={chainId:61997,contractAddress:address,expectedSpecHash:resolutionDigest(spec),
  minimumConfidenceBps:8500,minimumSources:1,maxAgeSeconds:3600,now:2_000_000_100,allowedOutcomes:['VERIFIED']};
const verdict={marketId:spec.marketId,specHash:policy.expectedSpecHash,evidence,evidenceDigest:resolutionDigest(evidence),
  observedAt:2_000_000_000,status:'RESOLVED',winnerIndex:0,outcomeId:'VERIFIED',attempt:1,confidenceBps:9500,
  rulesApplied:(spec.resolutionRules as string[]).map(rule=>({rule,satisfied:true,explanation:'Synthetic test'})),
  featuresApplied:(spec.features as Array<{id:string}>).map(f=>({feature:f.id,satisfied:true,explanation:'Synthetic test'})),
  conflicts:[],facts:[{claim:'SDK delivered',source:evidence[0].source,quote:'GenLayer deployment',supportsOutcome:'VERIFIED'}],
  reasonCode:'SYNTHETIC_DEMO',reasoningSummary:'Local fixture; not live consensus'};
const reader:ResolutionReader={getChainId:async()=>61997,
  readContract:async request=>JSON.stringify(request.functionName==='get_spec'?spec:verdict),
  getTransaction:async()=>({hash:transactionHash,to_address:address,statusName:'FINALIZED',txExecutionResultName:'FINISHED_WITH_RETURN',
    leader_only:false,result_name:'MAJORITY_AGREE',data:{calldata:{readable:'{"":"resolve","args":[],}'}},
    consensus_data:{leader_receipt:[{mode:'leader',execution_result:'SUCCESS'}]}})};
const executor=createResolutionExecutor({reader,store:createFileActionStore(resolve(directory,'action-store'))});
let writes=0;
const options={policy,transactionHash,action:{name:'release-delivery',input:{jobId:'example-job'}},
  apply:async({key}:{key:string})=>{writes++;await writeFile(resolve(directory,'released-work.json'),JSON.stringify({key,jobId:'example-job',status:'RELEASED',synthetic:true},null,2));return 'local-job:example-job:released';}};
const result=await executor.execute(options);
const replay=await executor.execute(options);
await writeFile(resolve(directory,'bundle.json'),JSON.stringify(result.bundle,null,2));
await writeFile(resolve(directory,'policy.json'),JSON.stringify(policy,null,2));
console.log(JSON.stringify({synthetic:true,action:result.status,replay:replay.status,downstreamWritesThisRun:writes,bundle:resolve(directory,'bundle.json')},null,2));
