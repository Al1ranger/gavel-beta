"""Real generated gate/storage; mocked cross-contract transport, not consensus."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
import pytest

ROOT = Path(__file__).resolve().parents[1]
NOW = 1792368000  # 2026-10-19T00:00:00Z


def digest(value):
    return "0x" + hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()


@pytest.fixture
def workflow(tmp_path, direct_vm, direct_deploy, direct_alice, monkeypatch):
    actor = "0x" + bytes(direct_alice).hex()
    subprocess.run(["node", "examples/workflow-contract.ts", str(tmp_path), actor], cwd=ROOT, check=True, capture_output=True)
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    spec = {"marketId": "OPENZEPPELIN-LICENSE-PERMISSION", "resolutionTime": 1757869200,
            "outcomes": [{"id": "PERMITTED", "index": 0}, {"id": "RESTRICTED", "index": 1}],
            "minimumConfidenceBps": 8500, "resolutionRules": ["Redistribution permitted", "Exact quote"],
            "features": [{"id": "NOTICE", "required": True}], "approvedSources": ["https://authority.example/license"],
            "evidence": {"minimumSources": 1}}
    evidence = [{"source": spec["approvedSources"][0], "available": True, "content": "Permission is granted. 日本語 😀", "error": ""}]
    verdict = {"marketId": spec["marketId"], "specHash": digest(spec), "status": "RESOLVED", "observedAt": NOW - 100,
               "attempt": 1, "winnerIndex": 0, "outcomeId": "PERMITTED", "confidenceBps": 9500,
               "rulesApplied": [{"rule": r, "satisfied": True} for r in spec["resolutionRules"]],
               "featuresApplied": [{"feature": "NOTICE", "satisfied": True}], "conflicts": [],
               "evidence": evidence, "evidenceDigest": digest(evidence),
               "facts": [{"source": spec["approvedSources"][0], "quote": "Permission is granted.", "supportsOutcome": "PERMITTED"}]}
    manifest["oracles"][0]["expectedSpecHash"] = digest(spec)
    # Regenerate from the fixture specification, preserving actual generator logic.
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    (tmp_path / "gate.py").unlink()
    subprocess.run(["node", "bin/gavel.mjs", "generate-workflow", str(tmp_path / "manifest.json"), str(tmp_path / "gate.py")], cwd=ROOT, check=True, capture_output=True)
    direct_vm.sender = direct_alice
    direct_vm.warp("2026-10-19T00:00:00Z")
    gate = direct_deploy(str(tmp_path / "gate.py"), sdk_version="v0.2.16")
    module = sys.modules[type(object.__getattribute__(gate, "_instance")).__module__]
    reads = []

    class View:
        def get_spec(self):
            reads.append("get_spec")
            return json.dumps(spec)

        def get_verdict(self):
            reads.append("get_verdict")
            return json.dumps(verdict)

    def contract_at(address):
        assert str(address).lower() == manifest["oracles"][0]["contractAddress"].lower()
        return SimpleNamespace(view=lambda: View())

    monkeypatch.setattr(module.gl, "get_contract_at", contract_at)
    return SimpleNamespace(gate=gate, spec=spec, verdict=verdict, reads=reads, manifest=manifest)


def test_gate_enforces_dependencies_and_persists_linked_receipts(workflow):
    f = workflow
    assert json.loads(f.gate.preview("RELEASE"))["blockers"] == ["DEPENDENCY:LEGAL"]
    with pytest.raises(Exception, match="CHECKPOINT_DEPENDENCY_REQUIRED"):
        f.gate.complete("RELEASE")
    assert f.gate.get_progress()["completed"] == 0
    first = json.loads(f.gate.complete("LEGAL"))
    assert f.reads == ["get_spec", "get_verdict"]
    second = json.loads(f.gate.complete("RELEASE"))
    assert second["dependencies"] == [{"checkpointId": "LEGAL", "receiptHash": first["receiptHash"]}]
    for r in [first, second]:
        receipt_hash = r.pop("receiptHash")
        assert digest(r) == receipt_hash
    assert f.gate.get_progress()["completed"] == 2


def test_wrong_actor_is_rejected_before_any_oracle_read(workflow, direct_vm, direct_bob):
    direct_vm.sender = direct_bob
    with pytest.raises(Exception, match="CHECKPOINT_ACTOR_REQUIRED"):
        workflow.gate.complete("LEGAL")
    assert workflow.reads == []
    assert workflow.gate.get_progress()["completed"] == 0


def test_repeat_completion_returns_identical_receipt_without_rechecking_or_writing(workflow):
    first = workflow.gate.complete("LEGAL")
    workflow.verdict["status"] = "UNRESOLVED"
    assert workflow.gate.complete("LEGAL") == first
    assert workflow.gate.get_progress()["completed"] == 1
    assert json.loads(workflow.gate.preview("LEGAL"))["status"] == "COMPLETED"
    assert workflow.reads == ["get_spec", "get_verdict"]


CASES = [
    ("unresolved", lambda s, v: v.update(status="UNRESOLVED"), "UNRESOLVED"),
    ("spec substitution", lambda s, v: s.update(question="Attacker semantics"), "SPEC_MISMATCH"),
    ("market substitution", lambda s, v: v.update(marketId="OTHER"), "MARKET"),
    ("wrong winner", lambda s, v: v.update(winnerIndex=1), "OUTCOME"),
    ("disallowed winner", lambda s, v: v.update(winnerIndex=1, outcomeId="RESTRICTED"), "OUTCOME"),
    ("false rule", lambda s, v: v["rulesApplied"][0].update(satisfied=False), "RULE"),
    ("truthy rule", lambda s, v: v["rulesApplied"][0].update(satisfied="true"), "RULE"),
    ("missing rule", lambda s, v: v.update(rulesApplied=[]), "RULE"),
    ("duplicate rule", lambda s, v: v["rulesApplied"].__setitem__(1, v["rulesApplied"][0]), "RULE"),
    ("false feature", lambda s, v: v["featuresApplied"][0].update(satisfied=False), "FEATURE"),
    ("missing feature", lambda s, v: v.update(featuresApplied=[]), "FEATURE"),
    ("conflict", lambda s, v: v.update(conflicts=["Conflicting authority"]), "CONFLICT"),
    ("low confidence", lambda s, v: v.update(confidenceBps=8499), "CONFIDENCE"),
    ("float confidence", lambda s, v: v.update(confidenceBps=9500.5), "JSON_TYPE"),
    ("future", lambda s, v: v.update(observedAt=NOW+1), "STALE_OR_FUTURE"),
    ("stale", lambda s, v: v.update(observedAt=NOW-366*86400), "STALE_OR_FUTURE"),
    ("invalid attempt", lambda s, v: v.update(attempt=True), "ATTEMPT"),
    ("changed evidence", lambda s, v: v["evidence"][0].update(content="Changed"), "DIGEST"),
    ("foreign evidence", lambda s, v: v["evidence"][0].update(source="https://attacker.example"), "EVIDENCE"),
    ("no evidence", lambda s, v: v.update(evidence=[]), "EVIDENCE"),
    ("forged quote", lambda s, v: v["facts"][0].update(quote="Invented permission"), "QUOTE"),
    ("no supporting fact", lambda s, v: v.update(facts=[]), "QUOTE"),
]


@pytest.mark.parametrize("name,mutate,error", CASES, ids=[c[0] for c in CASES])
def test_invalid_oracle_blocks_preview_and_atomic_completion(workflow, name, mutate, error):
    f = workflow
    mutate(f.spec, f.verdict)
    assert json.loads(f.gate.preview("LEGAL"))["status"] == "BLOCKED"
    with pytest.raises(Exception, match=error):
        f.gate.complete("LEGAL")
    assert f.gate.get_progress()["completed"] == 0
    with pytest.raises(Exception, match="NOT_COMPLETED"):
        f.gate.get_completion("LEGAL")


def test_unknown_checkpoint_fails_closed(workflow):
    for method in [workflow.gate.preview, workflow.gate.complete, workflow.gate.get_completion]:
        with pytest.raises(Exception, match="UNKNOWN_CHECKPOINT"):
            method("UNKNOWN")
