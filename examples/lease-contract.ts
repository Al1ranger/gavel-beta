import {mkdir, writeFile} from 'node:fs/promises';
import {generateLeaseContract} from '../dist/leases.js';

// Example identities only. Review/replace all identities before deployment.
const output = process.argv[2] ?? 'artifacts/lease-demo';
const subject = process.argv[3] ?? `0x${'1'.repeat(40)}`;
const controller = process.argv[4] ?? `0x${'2'.repeat(40)}`;
const generated = generateLeaseContract({gateId: 'AGENT-JOB-ACCESS', controller: controller as `0x${string}`,
  oracles: [{id: 'LICENSE', contractAddress: '0xf91789141312a8fe22c50489e2aafd0af645f2e7',
    expectedSpecHash: '0xe0772dcfcda9d27b345b491c238273f4785e166cf310b970413dafbe6cc78d0d',
    marketId: 'OPENZEPPELIN-LICENSE-PERMISSION', allowedOutcomes: ['PERMITTED'],
    minimumConfidenceBps: 8500, minimumSources: 1, maxAgeSeconds: 3600}],
  capabilities: [{id: 'BUILD-JOBS', subject: subject as `0x${string}`, resourceHash: `0x${'a'.repeat(64)}`,
    oracles: ['LICENSE'], leaseSeconds: 300, maxUses: 3}],
});
await mkdir(output, {recursive: true});
await writeFile(`${output}/gate.py`, generated.source);
await writeFile(`${output}/manifest.json`, JSON.stringify(generated.manifest, null, 2));
console.log(JSON.stringify({output, manifestHash: generated.manifestHash, deployed: false}));
