#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { prepareStudioNext } from './studio-next.mjs';
import { createGavelClient, normalizeMarketSpec, generateIntelligentContract, generateScalarOracle, generateOddsJournal, readApi, normalizeOdds, auditResolutionBundle } from '../dist/index.js';

const [command = 'help', value, output] = process.argv.slice(2);
const json = async path => {
  if (!path) throw new Error('A JSON file path is required.');
  return JSON.parse(await readFile(path, 'utf8'));
};
const print = data => console.log(JSON.stringify(data, null, 2));
function client() {
  if (!process.env.GAVEL_CONTRACT_ADDRESS) throw new Error('Set GAVEL_CONTRACT_ADDRESS.');
  return createGavelClient({ network: process.env.GAVEL_NETWORK || 'localnet', contractAddress: process.env.GAVEL_CONTRACT_ADDRESS, rpcUrl: process.env.GENLAYER_RPC_URL });
}
try {
  switch (command) {
    case 'help':
      console.log(`Gavel developer CLI
  validate <market.json>         Normalize a market specification
  generate <input.json> <file>   Generate a Python contract (refuses overwrite)
  generate-scalar <json> <file>  Generate a continuous payout oracle
  generate-odds <json> <file>    Generate a quoted-odds observation journal
  api <request.json>             Read JSON API with explicit allowedOrigins
  odds <book.json>               Normalize { book, outcomes }
  markets                       Read the configured resolver registry
  market <id>                   Read a registered specification
  verdict <id>                  Read a provisional verdict
  transaction <hash>            Inspect transaction finality

  studio-next-info              Print Studio Next chain and RPC settings
  prepare-studio-next <py> <dir> Create a resumable GenLayer CLI deployment project
  audit-resolution <bundle> <policy>  Offline evidence and policy audit (no chain authentication)

Reads require GAVEL_CONTRACT_ADDRESS, optional GAVEL_NETWORK and GENLAYER_RPC_URL.
This CLI does not sign transactions. Use the SDK with your own signer for writes.`);
      break;
    case 'validate': print(normalizeMarketSpec(await json(value))); break;
    case 'generate':
    case 'generate-scalar':
    case 'generate-odds': {
      if (!output) throw new Error('Provide an output Python filename.');
      const generate = command === 'generate-scalar' ? generateScalarOracle : command === 'generate-odds' ? generateOddsJournal : generateIntelligentContract;
      const generated = generate(await json(value));
      await writeFile(output, generated.source, { encoding: 'utf8', flag: 'wx' });
      print({ filename: output, className: generated.className, deployed: false });
      break;
    }
    case 'api': {
      const input = await json(value);
      if (!Array.isArray(input.allowedOrigins)) throw new Error('Provide allowedOrigins in the request file.');
      print(await readApi(input.request, { allowedOrigins: input.allowedOrigins, timeoutMs: input.timeoutMs, maxBytes: input.maxBytes }));
      break;
    }
    case 'odds': { const input = await json(value); print(normalizeOdds(input.book, input.outcomes)); break; }
    case 'markets': print(await client().listMarketIds()); break;
    case 'market': if (!value) throw new Error('Provide a market ID.'); print(await client().getMarket(value)); break;
    case 'verdict': if (!value) throw new Error('Provide a market ID.'); print({ finality: 'UNVERIFIED', verdict: await client().getVerdict(value) }); break;
    case 'transaction':
      if (!/^0x[0-9a-fA-F]{64}$/.test(value || '')) throw new Error('Provide a 32-byte transaction hash.');
      print(await client().getTransactionState(value)); break;
    case 'studio-next-info':
      print({ network: 'studioNext', chainId: 61997, rpcUrl: 'https://studio-dev.genlayer.com/api', explorer: 'https://explorer-studio-dev.genlayer.com' });
      break;
    case 'prepare-studio-next': print(await prepareStudioNext(value, output)); break;
    case 'audit-resolution': print(auditResolutionBundle(await json(value), await json(output))); break;
    default: throw new Error(`Unknown command: ${command}. Run gavel help.`);
  }
} catch (error) {
  // Avoid exposing provider payloads or credentials in automation logs.
  console.error(JSON.stringify({ error: ['validate', 'generate', 'generate-scalar', 'generate-odds', 'odds', 'help', 'prepare-studio-next', 'audit-resolution'].includes(command) ? error.message : 'Command failed. Check input, configuration and provider availability.', command }));
  process.exitCode = 1;
}
