# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from dataclasses import dataclass
import time


@allow_storage
@dataclass
class Receipt:
    receipt_id: str
    creator: Address
    payload_hash: str
    schema_version: str
    category: str
    recommendation_hash: str
    confidence_band: str
    created_at: u256
    public_summary_hash: str


class ChoiceLensDecisionRegistry(gl.Contract):
    receipts: TreeMap[str, Receipt]
    by_user: TreeMap[Address, TreeMap[str, bool]]

    def __init__(self):
        pass

    @gl.public.write
    def create_receipt(
        self,
        receipt_id: str,
        payload_hash: str,
        schema_version: str,
        category: str,
        recommendation_hash: str,
        confidence_band: str,
        public_summary_hash: str,
    ) -> str:
        assert receipt_id not in self.receipts, "receipt_id_taken"
        assert confidence_band in ("low", "medium", "high"), "invalid_confidence"
        creator = gl.message.sender_address
        self.receipts[receipt_id] = Receipt(
            receipt_id=receipt_id,
            creator=creator,
            payload_hash=payload_hash,
            schema_version=schema_version,
            category=category,
            recommendation_hash=recommendation_hash,
            confidence_band=confidence_band,
            created_at=u256(int(time.time())),
            public_summary_hash=public_summary_hash,
        )
        if creator not in self.by_user:
            self.by_user[creator] = gl.storage.inmem_allocate(TreeMap[str, bool])
        self.by_user[creator][receipt_id] = True
        return receipt_id

    @gl.public.view
    def get_receipt(self, receipt_id: str) -> Receipt:
        return self.receipts[receipt_id]

    @gl.public.view
    def get_user_receipts(self, addr: Address) -> list[str]:
        if addr not in self.by_user:
            return []
        return list(self.by_user[addr].keys())
