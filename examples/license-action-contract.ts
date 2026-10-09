import { mkdir, writeFile } from 'node:fs/promises';
import { generateIntelligentContract } from '../dist/contracts.js';

// Integration fixture, not legal advice or a complete license-compliance check.
// The consumer must retain the license notice separately before distributing.
export const licenseActionContract = generateIntelligentContract({
  className: 'GavelLicensePermissionResolver',
  spec: {
    marketId: 'OPENZEPPELIN-LICENSE-PERMISSION',
    question: 'Does this pinned OpenZeppelin license permit redistribution, subject to retaining copyright and permission notices?',
    outcomes: [
      {id:'PERMITTED', index:0, label:'Redistribution permission with notice condition'},
      {id:'RESTRICTED', index:1, label:'Document does not grant that permission'},
    ],
    resolutionTime: 1757869200,
    approvedSources: ['https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/c64a1edb67b6e3f4a15cca8909c9482ad33a02b0/LICENSE'],
    resolutionRules: [
      'Select PERMITTED only if the document grants redistribution and requires retention of copyright and permission notices; otherwise select RESTRICTED.',
      'Support each fact using an exact contiguous quote from the acquired document, without adding, omitting, or paraphrasing characters. Prefer short quotes within one sentence.',
    ],
    sourcePolicy: {authority:'OpenZeppelin repository at a pinned commit', corrections:'Use only the hash-pinned document; no caller-supplied claims.'},
  },
  shape: {kind:'BINARY'},
  evidence: {
    sources: [{
      url:'https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/c64a1edb67b6e3f4a15cca8909c9482ad33a02b0/LICENSE',
      format:'text', sha256:'13cd784a6c31361f0e0c6aa3b410a1cb9a079868b7314c13e3eb8a75351746b9',
    }],
  },
  minimumConfidenceBps: 8500,
  confidenceToleranceBps: 500,
});

await mkdir('artifacts/license-action', {recursive:true});
await writeFile('artifacts/license-action/contract.py', licenseActionContract.source);
await writeFile('artifacts/license-action/spec.json', JSON.stringify(licenseActionContract.compiledSpec,null,2));
