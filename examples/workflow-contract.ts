import {mkdir,writeFile} from 'node:fs/promises';
import {generateWorkflowContract} from '../dist/workflow.js';

// Example addresses only. Replace every address, actor and spec hash before deployment.
const output=process.argv[2]??'artifacts/workflow-demo';
const actor=process.argv[3]??`0x${'1'.repeat(40)}`;
const result=generateWorkflowContract({workflowId:'RELEASE-WORKFLOW',oracles:[{
  id:'LICENSE',contractAddress:'0xf91789141312a8fe22c50489e2aafd0af645f2e7',
  expectedSpecHash:'0xe0772dcfcda9d27b345b491c238273f4785e166cf310b970413dafbe6cc78d0d',
  marketId:'OPENZEPPELIN-LICENSE-PERMISSION',allowedOutcomes:['PERMITTED'],minimumConfidenceBps:8500,minimumSources:1,
  // Archive policy ONLY for an immutable, SHA-256-pinned document.
  maxAgeSeconds:365*86400,
}],checkpoints:[
  {id:'LEGAL',actor:actor as `0x${string}`,artifactHash:`0x${'a'.repeat(64)}`,requires:[],oracles:['LICENSE']},
  {id:'RELEASE',actor:actor as `0x${string}`,artifactHash:`0x${'b'.repeat(64)}`,requires:['LEGAL'],oracles:['LICENSE']},
]});
await mkdir(output,{recursive:true});
await writeFile(`${output}/gate.py`,result.source);
await writeFile(`${output}/manifest.json`,JSON.stringify(result.manifest,null,2));
console.log(JSON.stringify({manifestHash:result.manifestHash,output,deployed:false}));
