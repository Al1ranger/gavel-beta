/** Contract state machine. Oracle verification is shared with workflow gates. */
export const leaseRuntime = `
from genlayer.py.public_abi import StorageType

class __LEASE_CLASS__(gl.Contract):
    epochs: TreeMap[str, u32]
    uses: TreeMap[str, u32]
    grants: TreeMap[str, str]
    consumptions: TreeMap[str, str]
    revocations: TreeMap[str, str]

    def __init__(self):
        pass

    def _capability(self, capability_id: str) -> dict:
        for capability in json.loads(MANIFEST_JSON)["capabilities"]:
            if capability["id"] == capability_id:
                return capability
        raise gl.vm.UserError("[EXPECTED] UNKNOWN_CAPABILITY")

    def _now(self) -> int:
        return int(datetime.now(timezone.utc).timestamp())

    def _identity(self, capability: dict) -> dict:
        return {"version": 1, "gateId": json.loads(MANIFEST_JSON)["gateId"], "manifestHash": MANIFEST_HASH,
                "chainId": int(gl.message.chain_id), "contractAddress": str(gl.message.contract_address).lower(),
                "capabilityId": capability["id"], "subject": capability["subject"], "resourceHash": capability["resourceHash"]}

    def _read_oracles(self, capability: dict, now: int) -> list:
        policies = json.loads(MANIFEST_JSON)["oracles"]
        results = []
        for oracle_id in capability["oracles"]:
            policy = next(p for p in policies if p["id"] == oracle_id)
            try:
                oracle = gl.get_contract_at(Address(policy["contractAddress"]))
                view = oracle.view(state=StorageType.LATEST_FINAL)
                spec = view.get_spec()
                verdict = view.get_verdict()
            except Exception:
                raise gl.vm.UserError("[TRANSIENT] ORACLE_READ_FAILED")
            _check(isinstance(spec, str) and isinstance(verdict, str) and len(spec) <= 100000 and len(verdict) <= 1000000, "ORACLE_RESPONSE_BOUNDS")
            results.append(_verify_oracle(policy, json.loads(spec), json.loads(verdict), now))
        return results

    def _grant_key(self, capability_id: str, epoch: int) -> str:
        return capability_id + ":" + str(epoch)

    def _request_key(self, capability_id: str, request_id: str) -> str:
        _check(_hex(request_id, 64), "INVALID_REQUEST_ID")
        return capability_id + ":" + request_id

    def _subject(self, capability: dict) -> None:
        _check(gl.message.sender_address == Address(capability["subject"]), "LEASE_SUBJECT_REQUIRED")

    @gl.public.view
    def get_manifest(self) -> str:
        return MANIFEST_JSON

    @gl.public.view
    def get_state(self, capability_id: str) -> str:
        capability = self._capability(capability_id)
        result = self._identity(capability)
        result.update(epoch=int(self.epochs.get(capability_id, u32(0))), used=int(self.uses.get(capability_id, u32(0))),
                      maxUses=capability["maxUses"], revoked=capability_id in self.revocations)
        return _canonical(result)

    @gl.public.view
    def get_grant(self, capability_id: str, epoch: int) -> str:
        self._capability(capability_id)
        _check(_integer(epoch) and 1 <= epoch < 4294967296, "INVALID_LEASE_EPOCH")
        key = self._grant_key(capability_id, epoch)
        _check(key in self.grants, "LEASE_GRANT_NOT_FOUND")
        return self.grants[key]

    @gl.public.view
    def get_consumption(self, capability_id: str, request_id: str) -> str:
        self._capability(capability_id)
        key = self._request_key(capability_id, request_id)
        _check(key in self.consumptions, "LEASE_REQUEST_NOT_FOUND")
        return self.consumptions[key]

    @gl.public.view
    def get_revocation(self, capability_id: str) -> str:
        self._capability(capability_id)
        _check(capability_id in self.revocations, "LEASE_NOT_REVOKED")
        return self.revocations[capability_id]

    @gl.public.view
    def preview(self, capability_id: str) -> str:
        capability = self._capability(capability_id)
        result = json.loads(self.get_state(capability_id))
        result.update(status="ACTIVE", blockers=[])
        if result["revoked"]:
            result.update(status="REVOKED", blockers=["LEASE_REVOKED"])
        elif result["epoch"] == 0:
            result.update(status="NOT_OPEN", blockers=["LEASE_NOT_OPEN"])
        elif result["used"] >= capability["maxUses"]:
            result.update(status="EXHAUSTED", blockers=["LEASE_USE_LIMIT"])
        else:
            grant = json.loads(self.get_grant(capability_id, result["epoch"]))
            result["expiresAt"] = grant["expiresAt"]
            now = self._now()
            if now >= grant["expiresAt"]:
                result.update(status="EXPIRED", blockers=["LEASE_EXPIRED"])
            else:
                try:
                    self._read_oracles(capability, now)
                except Exception:
                    result.update(status="BLOCKED", blockers=["ORACLE_POLICY_FAILED"])
        return _canonical(result)

    @gl.public.write
    def renew(self, capability_id: str, expected_epoch: int) -> str:
        capability = self._capability(capability_id)
        self._subject(capability)
        _check(_integer(expected_epoch) and 0 <= expected_epoch < 4294967295, "INVALID_LEASE_EPOCH")
        epoch = int(self.epochs.get(capability_id, u32(0)))
        _check(epoch == expected_epoch, "LEASE_EPOCH_CHANGED")
        _check(capability_id not in self.revocations, "LEASE_REVOKED")
        used = int(self.uses.get(capability_id, u32(0)))
        _check(used < capability["maxUses"], "LEASE_USE_LIMIT")
        now = self._now()
        results = self._read_oracles(capability, now)
        policies = json.loads(MANIFEST_JSON)["oracles"]
        expires = now + capability["leaseSeconds"]
        for result in results:
            policy = next(p for p in policies if p["id"] == result["id"])
            expires = min(expires, result["observedAt"] + policy["maxAgeSeconds"])
        _check(expires > now, "LEASE_NO_FRESH_WINDOW")
        previous = json.loads(self.get_grant(capability_id, epoch))["grantHash"] if epoch else None
        grant = self._identity(capability)
        grant.update(kind="LEASE_GRANT", epoch=epoch + 1, issuedAt=now, expiresAt=expires,
                     usedAtGrant=used, previousGrantHash=previous, oracles=results)
        grant["grantHash"] = _digest(grant)
        encoded = _canonical(grant)
        self.grants[self._grant_key(capability_id, epoch + 1)] = encoded
        self.epochs[capability_id] = u32(epoch + 1)
        # Renewal never resets the lifetime use budget or request-id journal.
        return encoded

    @gl.public.write
    def consume(self, capability_id: str, expected_epoch: int, request_id: str) -> str:
        capability = self._capability(capability_id)
        self._subject(capability)
        _check(_integer(expected_epoch) and 1 <= expected_epoch < 4294967296, "INVALID_LEASE_EPOCH")
        key = self._request_key(capability_id, request_id)
        if key in self.consumptions:
            original = self.consumptions[key]
            _check(json.loads(original)["epoch"] == expected_epoch, "LEASE_REQUEST_EPOCH_MISMATCH")
            # Historical acknowledgement only. No new access or storage write.
            return original
        _check(capability_id not in self.revocations, "LEASE_REVOKED")
        _check(int(self.epochs.get(capability_id, u32(0))) == expected_epoch, "LEASE_EPOCH_CHANGED")
        used = int(self.uses.get(capability_id, u32(0)))
        _check(used < capability["maxUses"], "LEASE_USE_LIMIT")
        grant = json.loads(self.get_grant(capability_id, expected_epoch))
        now = self._now()
        _check(grant["issuedAt"] <= now < grant["expiresAt"], "LEASE_EXPIRED")
        results = self._read_oracles(capability, now)
        receipt = self._identity(capability)
        receipt.update(kind="LEASE_CONSUMPTION", epoch=expected_epoch, grantHash=grant["grantHash"],
                       requestId=request_id, consumedAt=now, sequence=used + 1, oracles=results)
        receipt["receiptHash"] = _digest(receipt)
        encoded = _canonical(receipt)
        self.consumptions[key] = encoded
        self.uses[capability_id] = u32(used + 1)
        return encoded

    @gl.public.write
    def revoke(self, capability_id: str, reason_hash: str) -> str:
        capability = self._capability(capability_id)
        _check(gl.message.sender_address == Address(json.loads(MANIFEST_JSON)["controller"]), "LEASE_CONTROLLER_REQUIRED")
        _check(_hex(reason_hash, 64), "INVALID_REVOCATION_REASON")
        if capability_id in self.revocations:
            original = self.revocations[capability_id]
            _check(json.loads(original)["reasonHash"] == reason_hash, "REVOCATION_ALREADY_RECORDED")
            return original
        record = self._identity(capability)
        record.update(kind="LEASE_REVOCATION", reasonHash=reason_hash, revokedAt=self._now(),
                      epoch=int(self.epochs.get(capability_id, u32(0))))
        record["revocationHash"] = _digest(record)
        encoded = _canonical(record)
        self.revocations[capability_id] = encoded
        return encoded
`;
