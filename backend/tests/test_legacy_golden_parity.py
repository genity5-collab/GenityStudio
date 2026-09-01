import base64
import json
from pathlib import Path
import zlib

import pytest

from app.encoder.coolformat import HEADER, decode_base93, deflate_raw
from app.encoder.legacy_subset import LegacySubsetCompiler


@pytest.mark.parametrize(
    "fixture_name",
    ["basic_legacy_subset", "control_table_modern", "touched_event", "unsupported_call", "get_service_and_property", "numeric_for", "if_else", "model_properties", "gui_properties", "gui_color_probe", "gui_click_event_probe", "gui_color3_new_probe", "gui_udim2_from_offset_probe", "gui_udim_corner_radius_probe", "cframe_property_probe", "orientation_vector3_property_probe", "gui_named_click_handler_probe", "gui_mouse_button_down_probe"],
)
def test_private_subset_matches_each_retained_legacy_serialized_fixture(fixture_name: str):
    fixture_path = Path(__file__).parent / "fixtures/golden" / f"{fixture_name}.json"
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))

    compiled = LegacySubsetCompiler().compile(fixture["source"])

    assert compiled.blocks == fixture["blocks"]
    assert list(compiled.skipped_features) == fixture["skippedFeatures"]
    assert compiled.serialized == fixture["serialized"]
    assert compiled.encoded.startswith(HEADER)
    assert zlib.decompress(decode_base93(compiled.encoded[len(HEADER) :]), wbits=-zlib.MAX_WBITS) == fixture["serialized"].encode("latin-1")

    legacy_stream = base64.b64decode(fixture["compressedBase64"])
    assert decode_base93(fixture["encoded"][len(HEADER) :]) == legacy_stream
    assert zlib.decompress(legacy_stream, wbits=-zlib.MAX_WBITS) == fixture["serialized"].encode("latin-1")
    assert zlib.decompress(deflate_raw(fixture["serialized"]), wbits=-zlib.MAX_WBITS) == fixture["serialized"].encode("latin-1")
