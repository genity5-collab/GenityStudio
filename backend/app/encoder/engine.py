from dataclasses import dataclass
import zlib

from app.core.config import Settings
from app.core.errors import INPUT_TOO_LARGE, INVALID_INPUT, OUTPUT_TOO_LARGE, SERVICE_UNAVAILABLE, SecureApiError
from app.encoder.coolformat import HEADER, decode_base93
from app.encoder.legacy_subset import LegacySubsetCompiler, SUB


@dataclass(frozen=True, slots=True)
class EncodeResult:
    encoded: str
    blocks: int
    skipped_features: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class DecodeResult:
    valid: bool
    blocks: int
    audited_compatibility: bool


class PrivateEncoder:
    """Server-only boundary for the CoolFormat-compatible legacy encoder port.

    The browser must never receive catalog mappings, serializer details, or transform rules.
    The compatibility implementation is intentionally activated only after its parity suite
    passes against the legacy catalog; returning an invented format would corrupt imports.
    """

    def __init__(self, settings: Settings):
        self._settings = settings

    @property
    def is_ready(self) -> bool:
        return self._settings.limited_compatibility_enabled

    def validate_source(self, source: str) -> str:
        if not isinstance(source, str) or not source.strip():
            raise INVALID_INPUT
        if len(source) > self._settings.max_encode_characters:
            raise INPUT_TOO_LARGE
        if "\x00" in source:
            raise INVALID_INPUT
        return source.replace("\r\n", "\n").replace("\r", "\n")

    def encode(self, source: str, mode: str) -> EncodeResult:
        self.validate_source(source)
        if mode not in {"default", "strict"}:
            raise INVALID_INPUT
        if not self.is_ready:
            raise SERVICE_UNAVAILABLE
        compiled = self.compile_for_parity(source)
        if compiled.blocks == 0:
            raise INVALID_INPUT
        return EncodeResult(
            encoded=compiled.encoded,
            blocks=compiled.blocks,
            skipped_features=compiled.skipped_features,
        )

    def decode(self, encoded: str) -> DecodeResult:
        if not self.is_ready:
            raise SERVICE_UNAVAILABLE
        if not isinstance(encoded, str) or not encoded.startswith(HEADER):
            raise INVALID_INPUT
        if len(encoded) > self._settings.max_encode_response_characters:
            raise INPUT_TOO_LARGE
        try:
            compressed = decode_base93(encoded[len(HEADER) :])
            inflater = zlib.decompressobj(wbits=-zlib.MAX_WBITS)
            serialized_bytes = inflater.decompress(compressed, self._settings.max_decode_serialized_characters + 1)
            serialized_bytes += inflater.flush(self._settings.max_decode_serialized_characters + 1 - len(serialized_bytes))
        except (ValueError, zlib.error) as exc:
            raise INVALID_INPUT from exc
        if not inflater.eof or inflater.unused_data or inflater.unconsumed_tail:
            raise INVALID_INPUT
        if len(serialized_bytes) > self._settings.max_decode_serialized_characters:
            raise OUTPUT_TOO_LARGE
        try:
            serialized = serialized_bytes.decode("latin-1")
        except UnicodeDecodeError as exc:
            raise INVALID_INPUT from exc
        if not serialized.startswith(SUB + SUB + "Editor"):
            raise INVALID_INPUT
        block_count = max(0, serialized.count(SUB + SUB + "Block") - 1)
        return DecodeResult(valid=True, blocks=block_count, audited_compatibility=True)

    def compile_for_parity(self, source: str):
        """Compile with the private audited subset for non-public parity testing only."""
        normalized = self.validate_source(source)
        compiled = LegacySubsetCompiler().compile(normalized)
        if len(compiled.encoded) > self._settings.max_encode_response_characters:
            raise OUTPUT_TOO_LARGE
        return compiled
