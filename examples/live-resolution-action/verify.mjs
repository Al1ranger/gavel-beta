import { createClient } from 'genlayer-js';
import { studioDevnet } from 'genlayer-js/chains';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createResolutionExecutor, createFileActionStore } from '../../dist/resolution.js';

async function retryRead(operation) {
  for(let attempt=0;;attempt++) {
    try { return await operation(); }
    catch(error) {
      if(attempt>=3 || (error.code!=='RPC_READ_FAILED' && error.message!=='LIVE_SOURCE_READ_FAILED')) throw error;
      // These failures occur before reservation/handler execution. Never retry
      // ACTION_RECONCILIATION_REQUIRED or ambiguous downstream effects.
      await new Promise(resolve=>setTimeout(resolve,4000*(attempt+1)));
    }
  }
}

// Read-only RPC: no signer and no new onchain transaction. The action is local.
const manifest = JSON.parse(await readFile(new URL('../../docs/deployments/resolution-actions-studio-next.json', import.meta.url),'utf8'));
const root = new URL('./data/',import.meta.url);
await mkdir(root,{recursive:true});
const reader = createClient({chain:studioDevnet});
const deployedSource = await retryRead(async()=>{
  try { return await reader.getContractCode(manifest.address); }
  catch { throw new Error('LIVE_SOURCE_READ_FAILED'); }
});
assert.equal(createHash('sha256').update(deployedSource).digest('hex'),manifest.sourceSha256);
const executor = createResolutionExecutor({reader,store:createFileActionStore(fileURLToPath(root))});
const policy = {
  chainId:manifest.chainId, contractAddress:manifest.address, expectedSpecHash:manifest.specHash,
  minimumConfidenceBps:8500, minimumSources:1, now:Math.floor(Date.now()/1000),
  // One-year archive policy ONLY for this immutable hash-pinned license fixture.
  maxAgeSeconds:365*86400, allowedOutcomes:['PERMITTED'],
};
let writes = 0;
const options = {
  policy,transactionHash:manifest.resolveTx,
  action:{name:'release-license-work',input:{jobId:'license-fixture-job'}},
  apply:async({key,bundle})=>{
    writes++;
    await writeFile(new URL('released-job.json',root),JSON.stringify({key,jobId:'license-fixture-job',status:'RELEASED',outcome:bundle.verdict.outcomeId},null,2));
    return 'local-job:license-fixture-job:released';
  },
};
const first=await retryRead(()=>executor.execute(options));
const replay=await retryRead(()=>executor.execute(options));
assert.equal(replay.status,'ALREADY_COMPLETED');
assert.equal(writes,first.status==='COMPLETED'?1:0);
await writeFile(new URL('bundle.json',root),JSON.stringify(first.bundle,null,2));
console.log(JSON.stringify({first:first.status,replay:replay.status,localWrites:writes,transactionHash:manifest.resolveTx},null,2));
