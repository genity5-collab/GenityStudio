import pytest

from app.core.config import Settings
from app.core.errors import INVALID_INPUT, OUTPUT_TOO_LARGE, SERVICE_UNAVAILABLE
from app.encoder.coolformat import HEADER, decode_base93, encode_base93, encode_envelope
from app.encoder.engine import PrivateEncoder
from app.encoder.legacy_subset import SUB


def test_limited_compatibility_is_server_disabled_by_default():
    encoder = PrivateEncoder(Settings(limited_compatibility_enabled=False))

    with pytest.raises(type(SERVICE_UNAVAILABLE)):
        encoder.encode('print("safe")', "default")


def test_limited_compatibility_encodes_audited_subset_and_decodes_only_a_safe_summary():
    encoder = PrivateEncoder(Settings(limited_compatibility_enabled=True))
    encoded = encoder.encode('local part = Instance.new("Part")\nprint("safe")', "default")
    decoded = encoder.decode(encoded.encoded)

    assert encoded.blocks == 2
    assert decoded.valid is True
    assert decoded.blocks == 2
    assert decoded.audited_compatibility is True


def test_limited_compatibility_rejects_non_coolformat_decode_input():
    encoder = PrivateEncoder(Settings(limited_compatibility_enabled=True))

    with pytest.raises(type(INVALID_INPUT)):
        encoder.decode("not-a-coolformat-payload")


def test_limited_compatibility_rejects_trailing_compressed_envelope_data():
    encoder = PrivateEncoder(Settings(limited_compatibility_enabled=True))
    encoded = encode_envelope(SUB + SUB + "Editor")
    compressed_with_trailing_data = decode_base93(encoded[len(HEADER) :]) + b"\x00"

    with pytest.raises(type(INVALID_INPUT)):
        encoder.decode(HEADER + encode_base93(compressed_with_trailing_data))


def test_limited_compatibility_enforces_decompressed_payload_limit():
    encoder = PrivateEncoder(Settings(limited_compatibility_enabled=True, max_decode_serialized_characters=10_000))
    oversized_envelope = encode_envelope(SUB + SUB + "Editor" + "x" * 10_001)

    with pytest.raises(type(OUTPUT_TOO_LARGE)):
        encoder.decode(oversized_envelope)
