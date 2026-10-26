"""Actual generated lease/storage; oracle transport is mocked, not consensus."""
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from test_workflow import CASES, digest

ROOT = Path(__file__).resolve().parents[1]
NOW = 1792368000
REQUEST = "0x" + "a" * 64
SECOND = "0x" + "b" * 64
THIRD = "0x" + "c" * 64
REASON = "0x" + "d" * 64


@pytest.fixture
def lease(tmp_path, direct_vm, direct_deploy, direct_alice, direct_bob, monkeypatch):
    subject = "0x" + bytes(direct_alice).hex()
    controller = "0x" + bytes(direct_bob).hex()
    subprocess.run(["node", "examples/lease-contract.ts", str(tmp_path), subject, controller], cwd=ROOT, check=True, capture_output=True)
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    spec = {"marketId": "OPENZEPPELIN-LICENSE-PERMISSION", "resolutionTime": 1757869200,
            "outcomes": [{"id": "PERMITTED", "index": 0}, {"id": "RESTRICTED", "index": 1}],
            "minimumConfidenceBps": 8500, "resolutionRules": ["Redistribution permitted", "Exact quote"],
            "features": [{"id": "NOTICE", "required": True}], "approvedSources": ["https://authority.example/license"],
            "evidence": {"minimumSources": 1}}
    evidence = [{"source": spec["approvedSources"][0], "available": True, "content": "Permission is granted. 日本語 😀", "error": ""}]
    verdict = {"marketId": spec["marketId"], "specHash": digest(spec), "status": "RESOLVED", "observedAt": NOW - 100,
               "attempt": 1, "winnerIndex": 0, "outcomeId": "PERMITTED", "confidenceBps": 9500,
               "rulesApplied": [{"rule": rule, "satisfied": True} for rule in spec["resolutionRules"]],
               "featuresApplied": [{"feature": "NOTICE", "satisfied": True}], "conflicts": [],
               "evidence": evidence, "evidenceDigest": digest(evidence),
               "facts": [{"source": spec["approvedSources"][0], "quote": "Permission is granted.", "supportsOutcome": "PERMITTED"}]}
    manifest["oracles"][0]["expectedSpecHash"] = digest(spec)
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    (tmp_path / "gate.py").unlink()
    subprocess.run(["node", "bin/gavel.mjs", "generate-leases", str(tmp_path / "manifest.json"), str(tmp_path / "gate.py")], cwd=ROOT, check=True, capture_output=True)
    direct_vm.sender = direct_alice
    direct_vm.warp("2026-10-19T00:00:00Z")
    gate = direct_deploy(str(tmp_path / "gate.py"), sdk_version="v0.2.16")
    module = sys.modules[type(object.__getattribute__(gate, "_instance")).__module__]
    reads = []

    class View:
        def get_spec(self):
            reads.append("spec")
            return json.dumps(spec)

        def get_verdict(self):
            reads.append("verdict")
            return json.dumps(verdict)

    def contract_at(address):
        assert str(address).lower() == manifest["oracles"][0]["contractAddress"].lower()

        def view(*, state):
            assert int(state) == 1  # The pinned SDK's LATEST_FINAL mode.
            return View()
        return SimpleNamespace(view=view)

    monkeypatch.setattr(module.gl, "get_contract_at", contract_at)
    return SimpleNamespace(gate=gate, spec=spec, verdict=verdict, reads=reads, vm=direct_vm, output=tmp_path,
                           manifest=manifest, subject=direct_alice, controller=direct_bob)


def state(f):
    return json.loads(f.gate.get_state("BUILD-JOBS"))


def test_real_storage_grant_and_job_consumption(lease):
    f = lease
    assert json.loads(f.gate.preview("BUILD-JOBS"))["status"] == "NOT_OPEN"
    grant = json.loads(f.gate.renew("BUILD-JOBS", 0))
    assert grant["epoch"] == 1
    assert grant["expiresAt"] == NOW + 300
    assert grant["previousGrantHash"] is None
    receipt = json.loads(f.gate.consume("BUILD-JOBS", 1, REQUEST))
    assert receipt["grantHash"] == grant["grantHash"]
    assert receipt["resourceHash"] == f.manifest["capabilities"][0]["resourceHash"]
    assert receipt["sequence"] == 1
    for record, field in [(grant, "grantHash"), (receipt, "receiptHash")]:
        assert digest({key: value for key, value in record.items() if key != field}) == record[field]
    assert state(f)["used"] == 1
    assert f.reads == ["spec", "verdict"] * 2


def test_python_receipts_pass_the_public_typescript_cli_audit(lease):
    f = lease
    grant = json.loads(f.gate.renew("BUILD-JOBS", 0))
    consumption = json.loads(f.gate.consume("BUILD-JOBS", 1, REQUEST))
    bundle = f.output / "bundle.json"
    bundle.write_text(json.dumps({"grant": grant, "consumption": consumption}))
    manifest = f.output / "manifest.json"
    manifest.write_text(f.gate.get_manifest())
    result = subprocess.run(["node", "bin/gavel.mjs", "audit-lease", str(manifest), str(bundle)],
                            cwd=ROOT, check=True, capture_output=True, text=True)
    assert json.loads(result.stdout)["finality"] == "CLAIMED_ONLY"


def test_renewal_preserves_lifetime_quota_and_immutable_grants(lease):
    f = lease
    first = f.gate.renew("BUILD-JOBS", 0)
    f.gate.consume("BUILD-JOBS", 1, REQUEST)
    second = json.loads(f.gate.renew("BUILD-JOBS", 1))
    assert second["usedAtGrant"] == 1
    assert second["previousGrantHash"] == json.loads(first)["grantHash"]
    assert f.gate.get_grant("BUILD-JOBS", 1) == first
    assert state(f)["used"] == 1
    with pytest.raises(Exception, match="EPOCH_CHANGED"):
        f.gate.consume("BUILD-JOBS", 1, SECOND)
    f.gate.consume("BUILD-JOBS", 2, SECOND)
    f.gate.consume("BUILD-JOBS", 2, THIRD)
    assert state(f)["used"] == 3
    assert json.loads(f.gate.preview("BUILD-JOBS"))["status"] == "EXHAUSTED"
    with pytest.raises(Exception, match="USE_LIMIT"):
        f.gate.renew("BUILD-JOBS", 2)
    with pytest.raises(Exception, match="USE_LIMIT"):
        f.gate.consume("BUILD-JOBS", 2, REASON)


def test_changed_epoch_blocks_concurrent_renewal_replay(lease):
    f = lease
    original = f.gate.renew("BUILD-JOBS", 0)
    with pytest.raises(Exception, match="EPOCH_CHANGED"):
        f.gate.renew("BUILD-JOBS", 0)
    assert f.gate.get_grant("BUILD-JOBS", 1) == original
    assert state(f)["epoch"] == 1


def test_historical_request_replay_does_not_reauthorize_after_revocation(lease):
    f = lease
    f.gate.renew("BUILD-JOBS", 0)
    receipt = f.gate.consume("BUILD-JOBS", 1, REQUEST)
    f.vm.sender = f.controller
    f.gate.revoke("BUILD-JOBS", REASON)
    f.vm.sender = f.subject
    reads = len(f.reads)
    assert f.gate.consume("BUILD-JOBS", 1, REQUEST) == receipt
    assert len(f.reads) == reads
    assert state(f)["used"] == 1
    with pytest.raises(Exception, match="REVOKED"):
        f.gate.consume("BUILD-JOBS", 1, SECOND)
    with pytest.raises(Exception, match="REVOKED"):
        f.gate.renew("BUILD-JOBS", 1)


def test_controller_revocation_is_permanent_and_journaled(lease):
    f = lease
    with pytest.raises(Exception, match="CONTROLLER_REQUIRED"):
        f.gate.revoke("BUILD-JOBS", REASON)
    f.vm.sender = f.controller
    record = f.gate.revoke("BUILD-JOBS", REASON)
    assert f.gate.revoke("BUILD-JOBS", REASON) == record
    assert json.loads(f.gate.get_revocation("BUILD-JOBS"))["epoch"] == 0
    assert json.loads(f.gate.preview("BUILD-JOBS"))["status"] == "REVOKED"
    with pytest.raises(Exception, match="ALREADY_RECORDED"):
        f.gate.revoke("BUILD-JOBS", REQUEST)


def test_wrong_subject_rejected_before_oracle_reads(lease):
    f = lease
    f.vm.sender = f.controller
    with pytest.raises(Exception, match="SUBJECT_REQUIRED"):
        f.gate.renew("BUILD-JOBS", 0)
    with pytest.raises(Exception, match="SUBJECT_REQUIRED"):
        f.gate.consume("BUILD-JOBS", 1, REQUEST)
    assert f.reads == []
    assert state(f)["epoch"] == 0


@pytest.mark.parametrize("offset", [-1, 0, 1])
def test_expiry_is_exclusive(lease, offset):
    f = lease
    f.gate.renew("BUILD-JOBS", 0)
    from datetime import datetime, timezone
    f.vm.warp(datetime.fromtimestamp(NOW + 300 + offset, timezone.utc).isoformat())
    if offset < 0:
        f.gate.consume("BUILD-JOBS", 1, REQUEST)
    else:
        assert json.loads(f.gate.preview("BUILD-JOBS"))["status"] == "EXPIRED"
        with pytest.raises(Exception, match="EXPIRED"):
            f.gate.consume("BUILD-JOBS", 1, REQUEST)
        assert state(f)["used"] == 0


def test_grant_cannot_outlive_its_observed_evidence(lease):
    f = lease
    f.verdict["observedAt"] = NOW - 3500
    assert json.loads(f.gate.renew("BUILD-JOBS", 0))["expiresAt"] == NOW + 100


def test_exact_freshness_limit_cannot_mint_zero_length_grant(lease):
    f = lease
    f.verdict["observedAt"] = NOW - 3600
    with pytest.raises(Exception, match="NO_FRESH_WINDOW"):
        f.gate.renew("BUILD-JOBS", 0)
    assert state(f)["epoch"] == 0


@pytest.mark.parametrize("name,mutate,error", CASES, ids=[case[0] for case in CASES])
def test_oracle_change_blocks_new_use_without_writing(lease, name, mutate, error):
    f = lease
    f.gate.renew("BUILD-JOBS", 0)
    mutate(f.spec, f.verdict)
    assert json.loads(f.gate.preview("BUILD-JOBS"))["status"] == "BLOCKED"
    with pytest.raises(Exception, match=error):
        f.gate.consume("BUILD-JOBS", 1, REQUEST)
    assert state(f)["used"] == 0
    with pytest.raises(Exception, match="NOT_FOUND"):
        f.gate.get_consumption("BUILD-JOBS", REQUEST)
    with pytest.raises(Exception, match=error):
        f.gate.renew("BUILD-JOBS", 1)
    assert state(f)["epoch"] == 1


def test_historical_replay_remains_same_after_renewal(lease):
    f = lease
    f.gate.renew("BUILD-JOBS", 0)
    original = f.gate.consume("BUILD-JOBS", 1, REQUEST)
    f.gate.renew("BUILD-JOBS", 1)
    assert f.gate.consume("BUILD-JOBS", 1, REQUEST) == original
    with pytest.raises(Exception, match="REQUEST_EPOCH_MISMATCH"):
        f.gate.consume("BUILD-JOBS", 2, REQUEST)
    assert state(f)["used"] == 1


@pytest.mark.parametrize("epoch", [True, -1, 4294967295])
def test_invalid_renewal_epoch(lease, epoch):
    with pytest.raises(Exception, match="INVALID_LEASE_EPOCH"):
        lease.gate.renew("BUILD-JOBS", epoch)


@pytest.mark.parametrize("request_id", ["", "job-id", "0x" + "A" * 64, "0x" + "a" * 63])
def test_invalid_request_commitment(lease, request_id):
    lease.gate.renew("BUILD-JOBS", 0)
    with pytest.raises(Exception, match="INVALID_REQUEST_ID"):
        lease.gate.consume("BUILD-JOBS", 1, request_id)
    assert state(lease)["used"] == 0


def test_oracle_transport_failure_is_fail_closed(lease, monkeypatch):
    f = lease
    f.gate.renew("BUILD-JOBS", 0)
    module = sys.modules[type(object.__getattribute__(f.gate, "_instance")).__module__]
    def fail(_address):
        raise RuntimeError("provider-secret")
    monkeypatch.setattr(module.gl, "get_contract_at", fail)
    assert json.loads(f.gate.preview("BUILD-JOBS"))["blockers"] == ["ORACLE_POLICY_FAILED"]
    with pytest.raises(Exception, match="ORACLE_READ_FAILED"):
        f.gate.consume("BUILD-JOBS", 1, REQUEST)
    assert state(f)["used"] == 0
