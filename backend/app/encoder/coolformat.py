"""Private CoolFormat transport primitives.

These functions reproduce the legacy envelope format only. They do not parse or
execute Luau and expose no catalog mappings to the browser. A complete parser
and serializer parity suite remains required before the encoder is enabled.
"""

from __future__ import annotations

import zlib

HEADER = "\x1a0000000000000004\x1b"
BASE93_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&'()*+,-./:;<=>?@[]^_`{|}~ "


def encode_base93(payload: bytes) -> str:
    """Encode bytes with the legacy two-character base-93 packing algorithm."""
    queue = 0
    bits = 0
    output: list[str] = []

    for byte in payload:
        queue += byte << bits
        bits += 8
        while bits > 13:
            value = queue & 0x1FFF
            if value > 456:
                queue >>= 13
                bits -= 13
            else:
                value = queue & 0x3FFF
                queue >>= 14
                bits -= 14
            output.append(BASE93_ALPHABET[value % 93])
            output.append(BASE93_ALPHABET[value // 93])

    if bits:
        output.append(BASE93_ALPHABET[queue % 93])
        if bits > 7 or queue > 92:
            output.append(BASE93_ALPHABET[queue // 93])

    return "".join(output)


def decode_base93(payload: str) -> bytes:
    """Decode the legacy base-93 packing for private compatibility tests."""
    lookup = {character: index for index, character in enumerate(BASE93_ALPHABET)}
    queue = 0
    bits = 0
    value = -1
    output = bytearray()

    for character in payload:
        if character not in lookup:
            raise ValueError("Invalid base-93 character")
        if value < 0:
            value = lookup[character]
            continue
        value += lookup[character] * 93
        queue |= value << bits
        bits += 13 if (value & 0x1FFF) > 456 else 14
        while bits >= 8:
            output.append(queue & 0xFF)
            queue >>= 8
            bits -= 8
        value = -1

    if value >= 0:
        queue |= value << bits
        bits += 7
        while bits >= 8:
            output.append(queue & 0xFF)
            queue >>= 8
            bits -= 8

    return bytes(output)


def deflate_raw(serialized_blocks: str) -> bytes:
    """Compress the byte-oriented serialized block payload using raw DEFLATE."""
    source = serialized_blocks.encode("latin-1", errors="strict")
    compressor = zlib.compressobj(
        level=6,
        method=zlib.DEFLATED,
        wbits=-zlib.MAX_WBITS,
        memLevel=zlib.DEF_MEM_LEVEL,
        strategy=zlib.Z_DEFAULT_STRATEGY,
    )
    return compressor.compress(source) + compressor.flush()


def encode_envelope(serialized_blocks: str) -> str:
    """Return a CoolFormat envelope for an already validated serialized payload."""
    return HEADER + encode_base93(deflate_raw(serialized_blocks))
