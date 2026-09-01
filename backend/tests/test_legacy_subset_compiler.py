from app.encoder.coolformat import HEADER
from app.encoder.legacy_subset import ESC, PRIVATE_CATALOG, SUB, LegacySubsetCompiler


def test_private_catalog_contains_the_extracted_legacy_template_set():
    assert len(PRIVATE_CATALOG) == 284
    assert "CreateObject" in PRIVATE_CATALOG
    assert "Color3ToBrickColor" in PRIVATE_CATALOG


def test_subset_compiler_emits_private_legacy_root_and_print_block():
    compiled = LegacySubsetCompiler().compile('print("Hello")')

    assert compiled.blocks == 1
    assert compiled.skipped_features == ()
    assert compiled.encoded.startswith(HEADER)
    assert SUB + "Name" + ESC + "ROOT" in compiled.serialized
    assert SUB + "Type" + ESC + "Print" in compiled.serialized
    assert ESC + "Text" + ESC + "0" + ESC + "Hello" in compiled.serialized


def test_subset_compiler_chains_create_property_and_print_in_source_order():
    compiled = LegacySubsetCompiler().compile(
        'local part = Instance.new("Part")\npart.Name = "Foundation"\nprint(part)'
    )

    assert compiled.blocks == 3
    assert "Create Object1" in compiled.serialized
    assert "Set Object Property1" in compiled.serialized
    assert "Print1" in compiled.serialized
    assert SUB + "ChildBlocks" + ESC + "Set Object Property1" in compiled.serialized
    assert SUB + "ChildBlocks" + ESC + "Print1" in compiled.serialized


def test_subset_compiler_reports_unsupported_syntax_without_executing_it():
    compiled = LegacySubsetCompiler().compile('local result = require(script.Parent.Module)\nprint("safe")')

    assert compiled.blocks == 1
    assert len(compiled.skipped_features) == 1
    assert "require" in compiled.skipped_features[0]


def test_catalog_directive_emits_a_private_template_with_safe_field_override():
    compiled = LegacySubsetCompiler().compile('--@block GetLeaderstat Player=player, StatName="Coins"')

    assert compiled.blocks == 1
    assert compiled.skipped_features == ()
    assert SUB + "Type" + ESC + "GetLeaderstat" in compiled.serialized
    assert ESC + "Player" + ESC + "0" + ESC + "player" in compiled.serialized
    assert ESC + "StatName" + ESC + "0" + ESC + "Coins" in compiled.serialized


def test_subset_compiler_supports_model_color_and_vector_building_primitives():
    compiled = LegacySubsetCompiler().compile(
        'local brick = Color3ToBrickColor(Color3.fromRGB(245, 205, 48))\n'
        'local position = Vector3.new(3, 4, 5)\n'
        'local part = Instance.new("Part")\n'
        'part.BrickColor = brick\n'
        'part.Position = position'
    )

    assert compiled.blocks == 5
    assert SUB + "Type" + ESC + "Color3ToBrickColor" in compiled.serialized
    assert ESC + "Color3" + ESC + "0" + ESC + "F5,CD,30" in compiled.serialized
    assert SUB + "Type" + ESC + "ConstructVector3" in compiled.serialized
    assert ESC + "Property" + ESC + "0" + ESC + "BrickColor" in compiled.serialized
    assert ESC + "Property" + ESC + "0" + ESC + "Position" in compiled.serialized


def test_subset_compiler_supports_basic_control_flow_tables_and_modern_luau_declarations():
    compiled = LegacySubsetCompiler().compile(
        '--!strict\nconst enabled: boolean = true\nlocal values = {}\nvalues["title"] = "Retro"\nif enabled then\nprint("ready")\nend'
    )

    assert compiled.blocks == 5
    assert compiled.skipped_features == ()
    assert SUB + "Type" + ESC + "If" in compiled.serialized
    assert SUB + "Type" + ESC + "CreateTable" in compiled.serialized
    assert SUB + "Type" + ESC + "SetTableValue" in compiled.serialized
    assert SUB + "ChildBlocks" + ESC + "Print1" in compiled.serialized


def test_subset_compiler_supports_audited_part_touched_callbacks():
    compiled = LegacySubsetCompiler().compile(
        'local part = Instance.new("Part")\npart.Touched:Connect(function(hit)\nprint("Touched")\nend)'
    )

    assert compiled.blocks == 3
    assert compiled.skipped_features == ()
    assert SUB + "Type" + ESC + "PartTouched" in compiled.serialized
    assert ESC + "otherPart" + ESC + "hit" + ESC + "EventConnection" + ESC + "touchConn" in compiled.serialized


def test_subset_compiler_supports_audited_numeric_for_loop_graphs():
    compiled = LegacySubsetCompiler().compile("for i = 1, 3 do\nprint(i)\nend")

    assert compiled.blocks == 4
    assert compiled.skipped_features == ()
    assert SUB + "Type" + ESC + "WhileLoop3" in compiled.serialized
    assert ESC + "VariableName" + ESC + "i" in compiled.serialized
    assert ESC + "Result" + ESC + "i" in compiled.serialized
