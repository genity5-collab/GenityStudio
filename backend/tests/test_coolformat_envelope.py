import zlib

from app.encoder.coolformat import BASE93_ALPHABET, HEADER, decode_base93, deflate_raw, encode_base93, encode_envelope


def test_coolformat_header_is_exact_legacy_import_header():
    assert HEADER == "\x1a0000000000000004\x1b"


def test_private_base93_matches_known_legacy_packing_vectors():
    assert len(BASE93_ALPHABET) == 93
    assert encode_base93(b"") == ""
    assert encode_base93(bytes([0])) == "AA"
    assert encode_base93(bytes([1])) == "BA"
    assert encode_base93(bytes([93])) == "AB"
    assert encode_base93(bytes([0, 0])) == "AAA"


def test_private_base93_round_trips_legacy_transport_bytes():
    payload = bytes(range(256))
    assert decode_base93(encode_base93(payload)) == payload


def test_raw_deflate_preserves_latin_one_block_serialization_bytes():
    serialized = "\x1bText\x1b0\x1bhello"
    assert zlib.decompress(deflate_raw(serialized), wbits=-zlib.MAX_WBITS) == serialized.encode("latin-1")


def test_envelope_prefixes_base93_encoded_raw_deflate_payload():
    serialized = "\x1bText\x1b0\x1bhello"
    envelope = encode_envelope(serialized)
    assert envelope.startswith(HEADER)
    assert envelope[len(HEADER) :] == encode_base93(deflate_raw(serialized))
