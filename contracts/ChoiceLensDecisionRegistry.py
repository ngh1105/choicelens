# contracts/ChoiceLensDecisionRegistry.py
from genlayer import *

class Receipt:
    receipt_id: str
    creator: Address
    payload_hash: bytes
    schema_version: str
    category: str
    recommendation_hash: bytes
    confidence_band: str
    created_at: u256
    public_summary_hash: bytes | None

class ChoiceLensDecisionRegistry(gl.Contract):
    receipts: TreeMap[str, Receipt]
    by_user: TreeMap[Address, DynArray[str]]

    def __init__(self):
        pass

    @gl.public.write
    def create_receipt(
        self,
        receipt_id: str,
        payload_hash: bytes,
        schema_version: str,
        category: str,
        recommendation_hash: bytes,
        confidence_band: str,
        public_summary_hash: bytes | None,
    ) -> str:
        assert receipt_id not in self.receipts, "receipt_id_taken"
        assert confidence_band in ("low", "medium", "high"), "invalid_confidence"
        r = Receipt()
        r.receipt_id = receipt_id
        r.creator = gl.message.sender_address
        r.payload_hash = payload_hash
        r.schema_version = schema_version
        r.category = category
        r.recommendation_hash = recommendation_hash
        r.confidence_band = confidence_band
        r.created_at = gl.block.timestamp
        r.public_summary_hash = public_summary_hash
        self.receipts[receipt_id] = r
        if r.creator not in self.by_user:
            self.by_user[r.creator] = DynArray[str]()
        self.by_user[r.creator].append(receipt_id)
        return receipt_id

    @gl.public.view
    def get_receipt(self, receipt_id: str) -> Receipt:
        return self.receipts[receipt_id]

    @gl.public.view
    def get_user_receipts(self, addr: Address) -> list[str]:
        if addr not in self.by_user:
            return []
        return list(self.by_user[addr])
