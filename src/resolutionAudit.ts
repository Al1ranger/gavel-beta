import { createHash } from 'node:crypto';
import type { AdjudicatedVerdict } from './oracleClient.ts';

type Hex = `0x${string}`;
export type ResolutionReceipt = {
  transactionHash: Hex; contractAddress: Hex; status: string; execution: string;
  consensus: string; leaderOnly: boolean; functionName: string; args: unknown[];
};
export type ResolutionBundle = {
  version: 1; chainId: number; contractAddress: Hex; transactionHash: Hex;
  spec: Record<string, unknown>; verdict: AdjudicatedVerdict; receipt: ResolutionReceipt;
  bundleHash: Hex;
};
export type ResolutionPolicy = {
  chainId: number; contractAddress: Hex; expectedSpecHash: Hex;
  minimumConfidenceBps: number; minimumSources: number; maxAgeSeconds: number;
  /** Unix seconds supplied by the consuming application's trusted clock. */
  now: number; allowedOutcomes: string[];
};
export class ResolutionError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'ResolutionError'; }
}
export function resolutionCheck(condition: unknown, code: string): asserts condition {
  if (!condition) throw new ResolutionError(code);
}

/** Python ensure_ascii=True canonical JSON for JSON values with safe integers.
 * Fractional/unsafe numbers are refused rather than guessing Python float output.
 */
export function canonicalResolutionJson(value: unknown): string {
  const ancestors = new Set<object>();
  const compare = (a: string, b: string) => {
    const x = Array.from(a, c => c.codePointAt(0)!); const y = Array.from(b, c => c.codePointAt(0)!);
    for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
    return x.length - y.length;
  };
  const encode = (item: unknown, depth: number): string => {
    resolutionCheck(depth <= 32, 'JSON_DEPTH');
    if (item === null || typeof item === 'boolean') return String(item);
    if (typeof item === 'string') return JSON.stringify(item).replace(/[\u007f-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    if (typeof item === 'number') { resolutionCheck(Number.isSafeInteger(item) && !Object.is(item, -0), 'JSON_INTEGER_REQUIRED'); return String(item); }
    resolutionCheck(item && typeof item === 'object' && !ancestors.has(item), 'INVALID_JSON');
    resolutionCheck(Array.isArray(item) || Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null, 'INVALID_JSON_OBJECT');
    ancestors.add(item);
    const result = Array.isArray(item) ? '[' + Array.from(item, v => encode(v, depth + 1)).join(',') + ']'
      : '{' + Object.keys(item).sort(compare).map(key => encode(key, depth + 1) + ':' + encode((item as Record<string, unknown>)[key], depth + 1)).join(',') + '}';
    ancestors.delete(item); return result;
  };
  const result = encode(value, 0);
  resolutionCheck(Buffer.byteLength(result) <= 2_000_000, 'BUNDLE_TOO_LARGE');
  return result;
}
export function resolutionDigest(value: unknown): Hex {
  return `0x${createHash('sha256').update(canonicalResolutionJson(value)).digest('hex')}`;
}
export function sealResolutionBundle(input: Omit<ResolutionBundle, 'bundleHash'>): ResolutionBundle {
  const copy = JSON.parse(canonicalResolutionJson(input));
  return { ...copy, bundleHash: resolutionDigest(copy) };
}

/** Offline integrity/policy check. A bundle's receipt is a claim, not a chain proof.
 * Only the executor's fresh trusted RPC acquisition authorizes a downstream action.
 */
export function auditResolutionBundle(bundle: ResolutionBundle, policy: ResolutionPolicy) {
  resolutionCheck(policy && Number.isSafeInteger(policy.chainId) && policy.chainId > 0
    && /^0x[0-9a-f]{40}$/i.test(policy.contractAddress) && /^0x[0-9a-f]{64}$/.test(policy.expectedSpecHash)
    && Number.isSafeInteger(policy.now) && policy.now > 0
    && Number.isSafeInteger(policy.minimumConfidenceBps) && policy.minimumConfidenceBps >= 0 && policy.minimumConfidenceBps <= 10000
    && Number.isSafeInteger(policy.minimumSources) && policy.minimumSources >= 1 && policy.minimumSources <= 8
    && Number.isSafeInteger(policy.maxAgeSeconds) && policy.maxAgeSeconds >= 1
    && Array.isArray(policy.allowedOutcomes) && policy.allowedOutcomes.length > 0
    && policy.allowedOutcomes.every(id => typeof id === 'string' && id !== 'UNRESOLVED' && id.length > 0), 'INVALID_POLICY');
  resolutionCheck(bundle && bundle.version === 1, 'BUNDLE_VERSION');
  const { bundleHash, ...fields } = bundle;
  resolutionCheck(resolutionDigest(fields) === bundleHash, 'BUNDLE_HASH_MISMATCH');
  resolutionCheck(bundle.chainId === policy.chainId && bundle.contractAddress.toLowerCase() === policy.contractAddress.toLowerCase(), 'DEPLOYMENT_MISMATCH');
  resolutionCheck(/^0x[0-9a-f]{64}$/i.test(bundle.transactionHash), 'INVALID_TRANSACTION_HASH');
  const { spec, verdict: v, receipt: r } = bundle;
  resolutionCheck(spec && resolutionDigest(spec) === policy.expectedSpecHash && v?.specHash === policy.expectedSpecHash, 'SPEC_HASH_MISMATCH');
  resolutionCheck(typeof spec.marketId === 'string' && v.marketId === spec.marketId, 'MARKET_MISMATCH');
  resolutionCheck(r && r.transactionHash.toLowerCase() === bundle.transactionHash.toLowerCase()
    && r.contractAddress.toLowerCase() === bundle.contractAddress.toLowerCase(), 'RECEIPT_BINDING_MISMATCH');
  resolutionCheck(r.status === 'FINALIZED' && r.execution === 'FINISHED_WITH_RETURN'
    && r.consensus === 'MAJORITY_AGREE' && r.leaderOnly === false, 'FINALIZED_CONSENSUS_REQUIRED');
  resolutionCheck(r.functionName === 'resolve' && Array.isArray(r.args) && r.args.length === 0, 'RESOLUTION_CALL_REQUIRED');
  resolutionCheck(Number.isSafeInteger(v.observedAt) && v.observedAt <= policy.now && v.observedAt > 0
    && policy.now - v.observedAt <= policy.maxAgeSeconds, 'STALE_OR_FUTURE_RESULT');
  resolutionCheck(Number.isSafeInteger(spec.resolutionTime) && v.observedAt >= Number(spec.resolutionTime), 'PREMATURE_RESOLUTION');
  resolutionCheck(v.status === 'RESOLVED', 'UNRESOLVED_RESULT');
  resolutionCheck(Number.isSafeInteger(v.attempt) && v.attempt >= 1, 'INVALID_ATTEMPT');
  const outcomes = spec.outcomes as Array<{id: string; index: number}>;
  resolutionCheck(Array.isArray(outcomes) && outcomes.length >= 2 && outcomes.length <= 16
    && outcomes.every((o, i) => o && typeof o.id === 'string' && o.id !== 'UNRESOLVED' && o.index === i)
    && new Set(outcomes.map(o => o.id)).size === outcomes.length, 'INVALID_OUTCOMES');
  resolutionCheck(Number.isSafeInteger(v.winnerIndex) && outcomes[v.winnerIndex]?.id === v.outcomeId
    && policy.allowedOutcomes.includes(v.outcomeId), 'OUTCOME_NOT_ALLOWED');
  resolutionCheck(Number.isSafeInteger(v.confidenceBps) && v.confidenceBps <= 10000
    && v.confidenceBps >= Math.max(policy.minimumConfidenceBps, Number(spec.minimumConfidenceBps ?? 0)), 'CONFIDENCE_TOO_LOW');
  const rules = spec.resolutionRules as string[];
  resolutionCheck(Array.isArray(rules) && rules.length > 0 && new Set(rules).size === rules.length
    && rules.every(rule => typeof rule === 'string' && rule.length > 0), 'INVALID_RULES');
  resolutionCheck(Array.isArray(v.rulesApplied) && v.rulesApplied.length === rules.length
    && new Set(v.rulesApplied.map(rule => rule.rule)).size === rules.length
    && v.rulesApplied.every(rule => rules.includes(rule.rule) && rule.satisfied === true), 'MANDATORY_RULE_UNSATISFIED');
  const features = spec.features as Array<{id: string; required: boolean}>;
  resolutionCheck(Array.isArray(features) && Array.isArray(v.featuresApplied)
    && features.every(f => f && typeof f.id === 'string' && typeof f.required === 'boolean')
    && new Set(features.map(f => f.id)).size === features.length
    && new Set(v.featuresApplied.map(f => f.feature)).size === v.featuresApplied.length
    && v.featuresApplied.every(f => features.some(declared => declared.id === f.feature) && typeof f.satisfied === 'boolean')
    && features.filter(f => f.required).every(f => v.featuresApplied.some(a => a.feature === f.id && a.satisfied === true)), 'MANDATORY_FEATURE_UNSATISFIED');
  resolutionCheck(Array.isArray(v.conflicts) && v.conflicts.length === 0, 'CONFLICTING_EVIDENCE');
  const sources = spec.approvedSources as string[];
  resolutionCheck(Array.isArray(sources) && sources.length >= 1 && sources.length <= 8
    && new Set(sources).size === sources.length && Array.isArray(v.evidence)
    && v.evidence.length === sources.length && new Set(v.evidence.map(e => e.source)).size === sources.length, 'EVIDENCE_SOURCE_MISMATCH');
  for (const e of v.evidence) resolutionCheck(e && sources.includes(e.source) && typeof e.available === 'boolean'
    && typeof e.content === 'string' && typeof e.error === 'string'
    && (e.available ? e.content.length > 0 && e.error === '' : e.content === '' && e.error.length > 0), 'INVALID_EVIDENCE_RECORD');
  resolutionCheck(resolutionDigest(v.evidence) === v.evidenceDigest, 'EVIDENCE_DIGEST_MISMATCH');
  const minimum = Math.max(policy.minimumSources, Number((spec.evidence as {minimumSources?: number})?.minimumSources ?? 1));
  resolutionCheck(v.evidence.filter(e => e.available).length >= minimum, 'INSUFFICIENT_SOURCES');
  resolutionCheck(Array.isArray(v.facts) && v.facts.some(f => {
    const quote = (f as typeof f & {quote?: string}).quote;
    return f.supportsOutcome === v.outcomeId && typeof quote === 'string' && quote.trim().length > 0
      && v.evidence.some(e => e.available && e.source === f.source && e.content.includes(quote));
  }), 'SUPPORTING_QUOTE_REQUIRED');
  return { integrity: 'VERIFIED' as const, policy: 'ELIGIBLE' as const, finality: 'CLAIMED_ONLY' as const,
    marketId: v.marketId, outcomeId: v.outcomeId, winnerIndex: v.winnerIndex, evidenceDigest: v.evidenceDigest, bundleHash };
}
