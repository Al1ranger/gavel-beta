import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TransactionHashVariant } from 'genlayer-js/types';
import { auditResolutionBundle, canonicalResolutionJson, resolutionCheck, resolutionDigest, ResolutionError,
  sealResolutionBundle, type ResolutionBundle, type ResolutionPolicy } from './resolutionAudit.ts';
import type { AdjudicatedVerdict } from './oracleClient.ts';

export type ResolutionReader = {
  getChainId(): Promise<number | string>;
  readContract(request: {address: `0x${string}`; functionName: string; args: never[]; transactionHashVariant: TransactionHashVariant}): Promise<unknown>;
  getTransaction(request: {hash: `0x${string}`}): Promise<unknown>;
};
export type ActionRecord = { key: string; payloadHash: `0x${string}`; status: 'RESERVED' | 'COMPLETED'; receipt?: string };
/** claim must atomically reserve across every worker sharing this store. */
export type ResolutionActionStore = {
  claim(record: ActionRecord): Promise<boolean>;
  get(key: string): Promise<ActionRecord | undefined>;
  complete(key: string, payloadHash: `0x${string}`, receipt: string): Promise<void>;
};
export function createMemoryActionStore(): ResolutionActionStore {
  const records = new Map<string, ActionRecord>();
  return {
    async claim(record) { if (records.has(record.key)) return false; records.set(record.key, { ...record }); return true; },
    async get(key) { const record = records.get(key); return record ? { ...record } : undefined; },
    async complete(key, payloadHash, receipt) {
      const record = records.get(key);
      resolutionCheck(record?.status === 'RESERVED' && record.payloadHash === payloadHash, 'ACTION_RESERVATION_MISMATCH');
      records.set(key, { ...record, status:'COMPLETED', receipt });
    },
  };
}
/** Durable reservations on one host/local filesystem. Do not use on NFS.
 * Interrupted/failed actions stay reserved; reconcile with the downstream system.
 */
export function createFileActionStore(directory: string): ResolutionActionStore {
  const filename = (key: string) => join(directory, resolutionDigest(key).slice(2) + '.json');
  const get = async (key: string): Promise<ActionRecord | undefined> => {
    try { const record = JSON.parse(await readFile(filename(key), 'utf8')); resolutionCheck(record.key === key, 'ACTION_STORE_CORRUPT'); return record; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  };
  return {
    get,
    async claim(record) {
      await mkdir(directory, {recursive:true});
      let handle;
      try { handle = await open(filename(record.key), 'wx', 0o600); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false; throw error; }
      try { await handle.writeFile(canonicalResolutionJson(record)); await handle.sync(); }
      finally { await handle.close(); }
      return true;
    },
    async complete(key, payloadHash, receipt) {
      const record = await get(key);
      resolutionCheck(record?.status === 'RESERVED' && record.payloadHash === payloadHash, 'ACTION_RESERVATION_MISMATCH');
      const temp = filename(key) + '.' + randomUUID() + '.tmp';
      const handle = await open(temp, 'wx', 0o600);
      try { await handle.writeFile(canonicalResolutionJson({ ...record, status:'COMPLETED', receipt })); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temp, filename(key));
    },
  };
}

/** GenLayer readable calldata may contain trailing commas. Remove them only
 * outside quoted strings; never execute calldata text as code.
 */
function parseReadable(text: string): unknown {
  let normalized = ''; let quoted = false; let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { normalized += c; if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
    else { if (c === '"') quoted = true; if (c === ',' && /^\s*[}\]]/.test(text.slice(i + 1))) continue; normalized += c; }
  }
  return JSON.parse(normalized);
}

/** Reads fresh FINALIZED state and a successful resolve receipt from the caller's
 * trusted RPC. No uploaded bundle or caller-supplied verdict can authorize execution.
 */
export async function readResolutionBundle(reader: ResolutionReader, policy: ResolutionPolicy, transactionHash: `0x${string}`): Promise<ResolutionBundle> {
  let chainId: number | string;
  try { chainId = await reader.getChainId(); } catch { throw new ResolutionError('RPC_READ_FAILED'); }
  resolutionCheck(Number(chainId) === policy.chainId, 'RPC_CHAIN_MISMATCH');
  const request = {address:policy.contractAddress, args:[] as never[], transactionHashVariant:TransactionHashVariant.LATEST_FINAL};
  let outputs: unknown[];
  try {
    outputs = await Promise.all([
      reader.readContract({ ...request, functionName:'get_spec' }),
      reader.readContract({ ...request, functionName:'get_verdict' }),
      reader.getTransaction({hash:transactionHash}),
    ]);
  } catch { throw new ResolutionError('RPC_READ_FAILED'); }
  const [specRaw, verdictRaw, receiptRaw] = outputs;
  let spec: unknown; let verdict: AdjudicatedVerdict;
  try {
    spec = typeof specRaw === 'string' ? JSON.parse(specRaw) : specRaw;
    verdict = (typeof verdictRaw === 'string' ? JSON.parse(verdictRaw) : verdictRaw) as AdjudicatedVerdict;
  } catch { throw new ResolutionError('INVALID_CONTRACT_JSON'); }
  const tx = receiptRaw as Record<string, any>;
  resolutionCheck(tx && typeof tx === 'object', 'RECEIPT_MISSING');
  const readable = tx.data?.calldata?.readable;
  resolutionCheck(typeof readable === 'string', 'READABLE_CALLDATA_REQUIRED');
  let call: any;
  try { call = parseReadable(readable); } catch { throw new ResolutionError('INVALID_CALLDATA'); }
  resolutionCheck(call && typeof call === 'object' && !Array.isArray(call)
    && Object.keys(call).every(key => key === '' || key === 'args'), 'INVALID_CALLDATA');
  resolutionCheck(tx.hash?.toLowerCase() === transactionHash.toLowerCase(), 'TRANSACTION_HASH_MISMATCH');
  resolutionCheck(tx.consensus_data?.leader_receipt?.some((r: any) => r.mode === 'leader' && r.execution_result === 'SUCCESS'), 'LEADER_EXECUTION_FAILED');
  // RESOLVED is terminal in the generated categorical contract. We deliberately
  // refuse unresolved/retryable results, avoiding a later attempt being mistaken
  // for the supplied receipt's decision.
  const bundle = sealResolutionBundle({ version:1, chainId:policy.chainId, contractAddress:policy.contractAddress,
    transactionHash, spec:spec as Record<string, unknown>, verdict,
    receipt:{transactionHash:tx.hash, contractAddress:tx.to_address, status:tx.statusName ?? tx.status,
      execution:tx.txExecutionResultName, consensus:tx.result_name, leaderOnly:tx.leader_only,
      functionName:call[''], args:Object.hasOwn(call, 'args') ? call.args : []},
  });
  auditResolutionBundle(bundle, policy);
  return bundle;
}

export type ResolutionAction = {
  /** One action per market/deployment/name. Stable across transaction hashes. */
  name: string;
  /** Caller-owned parameters, copied and committed before reservation. No secrets. */
  input: Record<string, unknown>;
};
export function createResolutionExecutor(config: {reader:ResolutionReader; store:ResolutionActionStore}) {
  return {
    async execute(options: { policy:ResolutionPolicy; transactionHash:`0x${string}`; action:ResolutionAction;
      apply(context:{key:string; input:Record<string, unknown>; bundle:ResolutionBundle}):Promise<string> }) {
      const action = JSON.parse(canonicalResolutionJson(options.action)) as ResolutionAction;
      const policy = JSON.parse(canonicalResolutionJson(options.policy)) as ResolutionPolicy;
      resolutionCheck(/^[a-z][a-z0-9_-]{2,63}$/.test(action.name) && action.input
        && typeof action.input === 'object' && !Array.isArray(action.input), 'INVALID_ACTION');
      const bundle = await readResolutionBundle(config.reader, policy, options.transactionHash);
      const key = resolutionDigest({chainId:policy.chainId, contract:policy.contractAddress.toLowerCase(), marketId:bundle.verdict.marketId, action:action.name});
      // Deliberately exclude mutable audit timestamps / transaction hashes.
      const payloadHash = resolutionDigest({specHash:bundle.verdict.specHash, outcome:bundle.verdict.outcomeId,
        evidenceDigest:bundle.verdict.evidenceDigest, action});
      const record:ActionRecord = {key,payloadHash,status:'RESERVED'};
      if (!await config.store.claim(record)) {
        const existing = await config.store.get(key);
        resolutionCheck(existing?.payloadHash === payloadHash, 'ACTION_CONFLICT');
        resolutionCheck(existing.status === 'COMPLETED', 'ACTION_RECONCILIATION_REQUIRED');
        return {status:'ALREADY_COMPLETED' as const,key,receipt:existing.receipt!,bundle};
      }
      try {
        const receipt = await options.apply({key, input:JSON.parse(canonicalResolutionJson(action.input)),
          bundle:JSON.parse(canonicalResolutionJson(bundle))});
        resolutionCheck(typeof receipt === 'string' && receipt.trim().length > 0 && receipt.length <= 2048, 'INVALID_ACTION_RECEIPT');
        await config.store.complete(key,payloadHash,receipt);
        return {status:'COMPLETED' as const,key,receipt,bundle};
      } catch { throw new ResolutionError('ACTION_RECONCILIATION_REQUIRED'); }
    },
  };
}
