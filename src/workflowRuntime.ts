/** Runtime for deterministic composition of independently adjudicated contracts.
 * Cross-contract views use GenLayer's current-block dependency semantics.
 */
export const workflowRuntime = `
from datetime import datetime, timezone


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False)


def _digest(value):
    return "0x" + hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _check(condition, code):
    if not condition:
        raise gl.vm.UserError("[EXPECTED] " + code)


def _integer(value):
    return type(value) is int and -9007199254740991 <= value <= 9007199254740991


def _hex(value, size):
    return isinstance(value, str) and len(value) == size + 2 and value.startswith("0x") and all(c in "0123456789abcdef" for c in value[2:])


def _safe_json(value, depth=0):
    _check(depth <= 32, "ORACLE_JSON_DEPTH")
    if value is None or type(value) is bool or isinstance(value, str):
        return
    if type(value) is int:
        _check(_integer(value), "ORACLE_JSON_INTEGER")
        return
    if isinstance(value, list):
        for item in value:
            _safe_json(item, depth + 1)
        return
    _check(isinstance(value, dict), "ORACLE_JSON_TYPE")
    for key, item in value.items():
        _check(isinstance(key, str), "ORACLE_JSON_KEY")
        _safe_json(item, depth + 1)


def _verify_oracle(policy, spec, verdict, now):
    _check(isinstance(spec, dict) and isinstance(verdict, dict), "ORACLE_OBJECT_REQUIRED")
    _safe_json(spec)
    _safe_json(verdict)
    _check(_digest(spec) == policy["expectedSpecHash"] and verdict.get("specHash") == policy["expectedSpecHash"], "ORACLE_SPEC_MISMATCH")
    _check(spec.get("marketId") == policy["marketId"] and verdict.get("marketId") == policy["marketId"], "ORACLE_MARKET_MISMATCH")
    _check(verdict.get("status") == "RESOLVED", "ORACLE_UNRESOLVED")
    observed = verdict.get("observedAt")
    _check(_integer(observed) and 0 < observed <= now and now - observed <= policy["maxAgeSeconds"], "ORACLE_STALE_OR_FUTURE")
    _check(_integer(spec.get("resolutionTime")) and observed >= spec["resolutionTime"], "ORACLE_PREMATURE")
    _check(_integer(verdict.get("attempt")) and verdict["attempt"] >= 1, "ORACLE_ATTEMPT")
    outcomes = spec.get("outcomes", [])
    _check(isinstance(outcomes, list) and 2 <= len(outcomes) <= 16, "ORACLE_OUTCOMES")
    _check(all(isinstance(o, dict) and isinstance(o.get("id"), str) and o["id"] != "UNRESOLVED" and type(o.get("index")) is int and o["index"] == i for i, o in enumerate(outcomes)), "ORACLE_OUTCOMES")
    _check(len(set(o["id"] for o in outcomes)) == len(outcomes), "ORACLE_OUTCOMES")
    winner = verdict.get("winnerIndex")
    _check(_integer(winner) and 0 <= winner < len(outcomes) and outcomes[winner]["id"] == verdict.get("outcomeId") and verdict["outcomeId"] in policy["allowedOutcomes"], "ORACLE_OUTCOME_NOT_ALLOWED")
    confidence = verdict.get("confidenceBps")
    minimum = spec.get("minimumConfidenceBps")
    _check(_integer(minimum) and 0 <= minimum <= 10000 and _integer(confidence) and max(minimum, policy["minimumConfidenceBps"]) <= confidence <= 10000, "ORACLE_CONFIDENCE")
    rules = spec.get("resolutionRules", [])
    applied = verdict.get("rulesApplied", [])
    _check(isinstance(rules, list) and len(rules) > 0 and all(isinstance(r, str) and len(r) > 0 for r in rules) and len(set(rules)) == len(rules), "ORACLE_RULES")
    _check(isinstance(applied, list) and len(applied) == len(rules) and all(isinstance(r, dict) and r.get("rule") in rules and r.get("satisfied") is True for r in applied), "ORACLE_RULE_UNSATISFIED")
    _check(len(set(r["rule"] for r in applied)) == len(rules), "ORACLE_RULE_COVERAGE")
    features = spec.get("features", [])
    checked = verdict.get("featuresApplied", [])
    _check(isinstance(features, list) and all(isinstance(f, dict) and isinstance(f.get("id"), str) and type(f.get("required")) is bool for f in features), "ORACLE_FEATURES")
    _check(len(set(f["id"] for f in features)) == len(features), "ORACLE_FEATURES")
    _check(isinstance(checked, list) and all(isinstance(f, dict) and isinstance(f.get("feature"), str) and type(f.get("satisfied")) is bool and any(d["id"] == f["feature"] for d in features) for f in checked), "ORACLE_FEATURES")
    _check(len(set(f["feature"] for f in checked)) == len(checked), "ORACLE_FEATURES")
    _check(all(any(f["feature"] == d["id"] and f["satisfied"] is True for f in checked) for d in features if d["required"]), "ORACLE_FEATURE_UNSATISFIED")
    _check(verdict.get("conflicts") == [], "ORACLE_CONFLICT")
    sources = spec.get("approvedSources", [])
    evidence = verdict.get("evidence", [])
    _check(isinstance(sources, list) and 1 <= len(sources) <= 8 and all(isinstance(s, str) for s in sources) and len(set(sources)) == len(sources), "ORACLE_SOURCES")
    _check(isinstance(evidence, list) and len(evidence) == len(sources), "ORACLE_EVIDENCE_COVERAGE")
    for record in evidence:
        _check(isinstance(record, dict) and record.get("source") in sources and type(record.get("available")) is bool and isinstance(record.get("content"), str) and isinstance(record.get("error"), str), "ORACLE_EVIDENCE_RECORD")
        _check((len(record["content"]) > 0 and record["error"] == "") if record["available"] else (record["content"] == "" and len(record["error"]) > 0), "ORACLE_EVIDENCE_RECORD")
    _check(len(set(e["source"] for e in evidence)) == len(sources), "ORACLE_EVIDENCE_COVERAGE")
    _check(_digest(evidence) == verdict.get("evidenceDigest"), "ORACLE_EVIDENCE_DIGEST")
    evidence_policy = spec.get("evidence", {})
    _check(isinstance(evidence_policy, dict) and _integer(evidence_policy.get("minimumSources")), "ORACLE_SOURCE_POLICY")
    minimum_sources = max(policy["minimumSources"], evidence_policy["minimumSources"])
    _check(minimum_sources >= 1 and sum(1 for e in evidence if e["available"]) >= minimum_sources, "ORACLE_INSUFFICIENT_SOURCES")
    facts = verdict.get("facts", [])
    _check(isinstance(facts, list) and any(isinstance(f, dict) and f.get("supportsOutcome") == verdict["outcomeId"] and isinstance(f.get("quote"), str) and len(f["quote"].strip()) > 0 and any(e["available"] and e["source"] == f.get("source") and f["quote"] in e["content"] for e in evidence) for f in facts), "ORACLE_SUPPORTING_QUOTE")
    return {"id": policy["id"], "contractAddress": policy["contractAddress"], "specHash": policy["expectedSpecHash"], "outcomeId": verdict["outcomeId"], "evidenceDigest": verdict["evidenceDigest"], "observedAt": observed}


class __WORKFLOW_CLASS__(gl.Contract):
    completions: TreeMap[str, str]
    completed_count: u32

    def __init__(self):
        self.completed_count = u32(0)

    def _checkpoint(self, checkpoint_id: str) -> dict:
        for checkpoint in json.loads(MANIFEST_JSON)["checkpoints"]:
            if checkpoint["id"] == checkpoint_id:
                return checkpoint
        raise gl.vm.UserError("[EXPECTED] UNKNOWN_CHECKPOINT")

    def _read_oracle(self, policy: dict, now: int) -> dict:
        oracle = gl.get_contract_at(Address(policy["contractAddress"]))
        spec_raw = oracle.view().get_spec()
        verdict_raw = oracle.view().get_verdict()
        _check(isinstance(spec_raw, str) and isinstance(verdict_raw, str) and len(spec_raw) <= 100000 and len(verdict_raw) <= 1000000, "ORACLE_RESPONSE_BOUNDS")
        return _verify_oracle(policy, json.loads(spec_raw), json.loads(verdict_raw), now)

    @gl.public.view
    def get_manifest(self) -> str:
        return MANIFEST_JSON

    @gl.public.view
    def get_progress(self) -> dict:
        return {"workflowId": json.loads(MANIFEST_JSON)["workflowId"], "manifestHash": MANIFEST_HASH, "completed": int(self.completed_count), "total": len(json.loads(MANIFEST_JSON)["checkpoints"])}

    @gl.public.view
    def get_completion(self, checkpoint_id: str) -> str:
        self._checkpoint(checkpoint_id)
        _check(checkpoint_id in self.completions, "CHECKPOINT_NOT_COMPLETED")
        return self.completions[checkpoint_id]

    @gl.public.view
    def preview(self, checkpoint_id: str) -> str:
        checkpoint = self._checkpoint(checkpoint_id)
        result = {"checkpointId": checkpoint_id, "manifestHash": MANIFEST_HASH, "status": "READY", "blockers": []}
        if checkpoint_id in self.completions:
            result["status"] = "COMPLETED"
            result["receipt"] = json.loads(self.completions[checkpoint_id])
            return _canonical(result)
        for dependency in checkpoint["requires"]:
            if dependency not in self.completions:
                result["blockers"].append("DEPENDENCY:" + dependency)
        if not result["blockers"]:
            now = int(datetime.now(timezone.utc).timestamp())
            policies = json.loads(MANIFEST_JSON)["oracles"]
            for oracle_id in checkpoint["oracles"]:
                policy = next(p for p in policies if p["id"] == oracle_id)
                try:
                    self._read_oracle(policy, now)
                except Exception:
                    result["blockers"].append("ORACLE:" + oracle_id)
        if result["blockers"]:
            result["status"] = "BLOCKED"
        return _canonical(result)

    @gl.public.write
    def complete(self, checkpoint_id: str) -> str:
        checkpoint = self._checkpoint(checkpoint_id)
        _check(gl.message.sender_address == Address(checkpoint["actor"]), "CHECKPOINT_ACTOR_REQUIRED")
        if checkpoint_id in self.completions:
            return self.completions[checkpoint_id]
        dependencies = []
        for dependency in checkpoint["requires"]:
            _check(dependency in self.completions, "CHECKPOINT_DEPENDENCY_REQUIRED")
            dependencies.append({"checkpointId": dependency, "receiptHash": json.loads(self.completions[dependency])["receiptHash"]})
        now = int(datetime.now(timezone.utc).timestamp())
        policies = json.loads(MANIFEST_JSON)["oracles"]
        results = []
        for oracle_id in checkpoint["oracles"]:
            policy = next(p for p in policies if p["id"] == oracle_id)
            results.append(self._read_oracle(policy, now))
        receipt = {"version": 1, "workflowId": json.loads(MANIFEST_JSON)["workflowId"], "manifestHash": MANIFEST_HASH, "checkpointId": checkpoint_id, "actor": checkpoint["actor"], "artifactHash": checkpoint["artifactHash"], "completedAt": now, "sequence": int(self.completed_count) + 1, "dependencies": dependencies, "oracles": results}
        receipt["receiptHash"] = _digest(receipt)
        encoded = _canonical(receipt)
        self.completions[checkpoint_id] = encoded
        self.completed_count = u32(int(self.completed_count) + 1)
        return encoded
`;
