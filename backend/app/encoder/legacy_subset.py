"""Private, non-executing Luau-to-CoolFormat subset compiler.

This module translates a deliberately narrow set of source forms into the legacy
serialized block representation. It never evaluates Luau, imports user modules,
or performs network or Roblox operations. It is a foundation for catalog parity,
not a signal that the public encoder may be activated.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from app.encoder.coolformat import encode_envelope

SUB = "\x1a"
ESC = "\x1b"


def _load_private_catalog() -> dict[str, dict[str, str]]:
    catalog_path = Path(__file__).with_name("private_catalog.json")
    with catalog_path.open("r", encoding="utf-8") as catalog_file:
        catalog = json.load(catalog_file)
    if not isinstance(catalog, dict) or not catalog:
        raise RuntimeError("Private CoolFormat catalog is unavailable")
    return catalog


PRIVATE_CATALOG = _load_private_catalog()


@dataclass(slots=True)
class LegacyBlock:
    type: str
    name: str
    position: str
    inputs: str
    outputs: str
    child: str | None = None
    else_child: str | None = None


@dataclass(frozen=True, slots=True)
class Compilation:
    serialized: str
    encoded: str
    blocks: int
    skipped_features: tuple[str, ...]


def _escape_value(value: str) -> str:
    return re.sub(r"[\x00-\x1f\x7f]", "", value)


def _hex_number(value: str) -> str:
    raw = value.replace("_", "").strip()
    number = int(float(raw), 0) if raw.lower().startswith(("0x", "-0x", "0b", "-0b")) else int(float(raw))
    return format(max(0, number), "X")


def _typed_value(value: str) -> str:
    normalized = value.strip()
    if re.fullmatch(r"-?(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d[\d_]*)?)", normalized):
        return ESC + "1" + ESC + _hex_number(normalized) + ESC + "Number"
    if len(normalized) >= 2 and normalized[0] in "\"'" and normalized[-1] == normalized[0]:
        return ESC + "1" + ESC + _escape_value(normalized[1:-1]) + ESC + "String"
    if normalized == "true":
        return ESC + "1" + ESC + "1" + ESC + "Bool"
    if normalized == "false":
        return ESC + "1" + ESC + "0" + ESC + "Bool"
    if normalized == "nil":
        return ESC + "1" + ESC + ESC + "Nil"
    return ESC + "2" + ESC + _escape_value(normalized)


def _position(index: int) -> str:
    x = index * 3
    y = 0
    if x > 36:
        y = 4
        x -= 37
    return f"{x:X}.0,{y:X}.0"


def _serialize_block(block: LegacyBlock) -> str:
    child = ESC + block.child if block.child else ""
    else_child = ESC + (block.else_child or "nil")
    return (
        SUB
        + SUB
        + "Block"
        + SUB
        + "Type"
        + ESC
        + block.type
        + SUB
        + "Name"
        + ESC
        + block.name
        + SUB
        + "VisualPosition"
        + ESC
        + block.position
        + SUB
        + "ChildBlocks"
        + child
        + SUB
        + "ElseChildBlock"
        + else_child
        + SUB
        + "Inputs"
        + block.inputs
        + SUB
        + "Outputs"
        + block.outputs
    )


def _editor() -> str:
    return SUB + SUB + "Editor" + SUB + "CameraPosition" + ESC + "2.3F,0.3BF" + SUB + "CameraZoom" + ESC + "0.C2"


class LegacySubsetCompiler:
    """Compile only audited, line-oriented legacy source patterns."""

    def compile(self, source: str) -> Compilation:
        blocks: list[LegacyBlock] = []
        skipped: list[str] = []
        counters: dict[str, int] = {}
        open_control_blocks: list[LegacyBlock] = []
        top_level_blocks: list[LegacyBlock] = []
        control_children: dict[str, list[LegacyBlock]] = {}
        else_control_children: dict[str, list[LegacyBlock]] = {}
        active_else_controls: set[str] = set()
        numeric_loop_steps: dict[str, tuple[str, str]] = {}
        unsupported_named_function_lines: list[str] | None = None
        unsupported_named_function_depth = 0

        def add(type_name: str, label: str, inputs: str = "", outputs: str = "") -> LegacyBlock:
            counters[label] = counters.get(label, 0) + 1
            block = LegacyBlock(
                type=type_name,
                name=f"{label}{counters[label]}",
                position=_position(len(blocks)),
                inputs=inputs,
                outputs=outputs,
            )
            blocks.append(block)
            if open_control_blocks:
                active_control = open_control_blocks[-1]
                child_map = else_control_children if active_control.name in active_else_controls else control_children
                child_map.setdefault(active_control.name, []).append(block)
            else:
                top_level_blocks.append(block)
            return block

        normalized_source = self._normalize_modern_luau(source)
        for raw_line in normalized_source.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
            line = raw_line.strip()
            if not line:
                continue
            directive = re.fullmatch(r"--@block\s+(\w+)(?:\s+(.*))?", line)
            if directive:
                template_name = directive.group(1)
                template = PRIVATE_CATALOG.get(template_name)
                if not template:
                    skipped.append(f"Skipped unknown private catalog block: {template_name}")
                    continue
                try:
                    add(
                        template_name,
                        template_name,
                        self._catalog_inputs(template["i"], self._parse_overrides(directive.group(2) or "")),
                        template["o"],
                    )
                except ValueError:
                    skipped.append(f"Skipped malformed private catalog directive: {template_name}")
                continue
            if line.startswith("--"):
                continue
            line = self._strip_trailing_comment(line)
            if not line:
                continue
            if unsupported_named_function_lines is not None:
                if line == "end":
                    unsupported_named_function_depth -= 1
                    if unsupported_named_function_depth == 0:
                        skipped.append(f"Skip: {''.join(unsupported_named_function_lines)}")
                        skipped.append("Skip: end")
                        unsupported_named_function_lines = None
                    else:
                        unsupported_named_function_lines.append(line)
                    continue
                unsupported_named_function_lines.append(line)
                if re.fullmatch(r"(?:local\s+)?function\s+\w+\s*\(.*\)", line) or re.fullmatch(r"(?:if|for|while)\b.*(?:then|do)", line):
                    unsupported_named_function_depth += 1
                continue
            if re.fullmatch(r"local\s+function\s+\w+\s*\(.*\)", line):
                unsupported_named_function_lines = [line]
                unsupported_named_function_depth = 1
                continue
            numeric_for = re.fullmatch(r"for\s+(\w+)\s*=\s*([^,]+)\s*,\s*([^,\s]+)(?:\s*,\s*([^\s]+))?\s+do", line)
            if numeric_for and all(self._is_number(value) for value in numeric_for.groups()[1:3]):
                variable, start, finish, step = numeric_for.groups()
                add("SetVariable1", f"Init {variable}", ESC + "Value" + _typed_value(start), ESC + "VariableName" + ESC + variable)
                loop = add(
                    "WhileLoop3",
                    "While Loop",
                    ESC + "Value 1" + _typed_value(variable) + ESC + "Value 2" + _typed_value(finish) + ESC + "ComparisonType" + ESC + "0" + ESC + "<=",
                )
                numeric_loop_steps[loop.name] = (variable, step or "1")
                open_control_blocks.append(loop)
                continue
            condition = re.fullmatch(r"if\s+(.+)\s+then", line)
            if condition:
                open_control_blocks.append(add("If", "If", self._condition_inputs(condition.group(1))))
                continue
            if line in {"end", "end)"} and open_control_blocks:
                closed = open_control_blocks.pop()
                active_else_controls.discard(closed.name)
                if closed.name in numeric_loop_steps:
                    variable, step = numeric_loop_steps[closed.name]
                    open_control_blocks.append(closed)
                    add(
                        "Addition",
                        f"Step {variable}",
                        ESC + "Number1" + _typed_value(variable) + ESC + "Number2" + _typed_value(step),
                        ESC + "Result" + ESC + variable,
                    )
                    open_control_blocks.pop()
                continue
            if line == "else" and open_control_blocks and open_control_blocks[-1].type == "If":
                active_else_controls.add(open_control_blocks[-1].name)
                continue
            if line.startswith("elseif "):
                skipped.append(f"Skipped unsupported control-flow branch: {line[:72]}")
                continue
            event = re.fullmatch(r"([\w.]+)\.Touched\s*:\s*Connect\s*\(\s*function\s*\(\s*(\w+)\s*\)\s*", line)
            if event:
                open_control_blocks.append(
                    add(
                        "PartTouched",
                        "Part Touched",
                        ESC + "Part" + ESC + "0" + ESC + event.group(1),
                        ESC + "otherPart" + ESC + event.group(2) + ESC + "EventConnection" + ESC + "touchConn",
                    )
                )
                continue
            event = re.fullmatch(r"([\w.]+)\.MouseButton1Click\s*:\s*Connect\s*\(\s*function\s*\(\s*\)\s*", line)
            if event:
                open_control_blocks.append(
                    add(
                        "GUILeftMouseButtonClick",
                        "GUI Left Click",
                        ESC + "GUIButton" + ESC + "0" + ESC + event.group(1),
                    )
                )
                continue

            match = re.fullmatch(r"print\s*\(\s*(['\"])(.*?)\1\s*\)", line)
            if match:
                add("Print", "Print", ESC + "Text" + ESC + "0" + ESC + _escape_value(match.group(2)))
                continue
            match = re.fullmatch(r"print\s*\(\s*([\w.]+)\s*\)", line)
            if match:
                add("Print", "Print", ESC + "Text" + _typed_value(match.group(1)))
                continue
            match = re.fullmatch(r"(?:task\.)?wait\s*\(\s*([^)]*)\s*\)", line)
            if match:
                wait_value = match.group(1).strip() or "0.03"
                add("Wait", "Wait", ESC + "Time" + _typed_value(wait_value))
                continue
            match = re.fullmatch(
                r"local\s+(\w+)\s*=\s*Color3ToBrickColor\s*\(\s*Color3\.fromRGB\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)\s*\)",
                line,
            )
            if match and all(self._is_number(value) for value in match.groups()[1:]):
                color = ",".join(self._rgb_component(value) for value in match.groups()[1:])
                add("Color3ToBrickColor", "Color3 to BrickColor", ESC + "Color3" + ESC + "0" + ESC + color, ESC + "BrickColor" + ESC + match.group(1))
                continue
            match = re.fullmatch(r"local\s+(\w+)\s*=\s*Vector3\.new\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)", line)
            if match:
                x, y, z = (_typed_value(value) for value in match.groups()[1:])
                add(
                    "ConstructVector3",
                    "Vector3",
                    ESC + "X" + x + ESC + "Y" + y + ESC + "Z" + z,
                    ESC + "Vector3" + ESC + match.group(1),
                )
                continue
            match = re.fullmatch(r"local\s+(\w+)\s*=\s*\{\s*\}", line)
            if match:
                add("CreateTable", "Create Table", "", ESC + "TableVariable" + ESC + match.group(1))
                continue
            match = re.fullmatch(r"local\s+(\w+)\s*=\s*Instance\.new\s*\(\s*(['\"])(\w+)\2\s*,\s*([\w.]+)\s*\)", line)
            if match:
                add(
                    "CreateObject",
                    "Create Object",
                    ESC + "Parent" + ESC + "0" + ESC + match.group(4) + ESC + "ClassName" + ESC + "0" + ESC + match.group(3),
                    ESC + "Object" + ESC + match.group(1),
                )
                continue
            match = re.fullmatch(r"local\s+(\w+)\s*=\s*Instance\.new\s*\(\s*(['\"])(\w+)\2\s*\)", line)
            if match:
                add(
                    "CreateObject",
                    "Create Object",
                    ESC + "Parent" + ESC + "0" + ESC + "script.Parent" + ESC + "ClassName" + ESC + "0" + ESC + match.group(3),
                    ESC + "Object" + ESC + match.group(1),
                )
                continue
            match = re.fullmatch(r"local\s+(\w+)\s*=\s*(.+)", line)
            if match and self._is_simple_value(match.group(2)):
                add("SetVariable1", "Set Variable", ESC + "Value" + _typed_value(match.group(2)), ESC + "VariableName" + ESC + match.group(1))
                continue
            match = re.fullmatch(r"([\w.]+)\.(Size|Position)\s*=\s*UDim2\.new\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)", line)
            if match and all(self._is_number(value) for value in match.groups()[2:]):
                object_name, property_name, x_scale, x_offset, y_scale, y_offset = match.groups()
                add(
                    "ConstructUDim2",
                    "Construct UDim2",
                    ESC + "XOffset" + _typed_value(x_offset) + ESC + "XScale" + _typed_value(x_scale) + ESC + "YScale" + _typed_value(y_scale) + ESC + "YOffset" + _typed_value(y_offset),
                    ESC + "UDim2" + ESC + "_udim0",
                )
                add(
                    "SetObjectProperty",
                    "Set Object Property",
                    ESC + "Value" + ESC + "2" + ESC + "_udim0" + ESC + "Property" + ESC + "0" + ESC + property_name + ESC + "Object" + ESC + "0" + ESC + object_name,
                )
                continue
            match = re.fullmatch(r"([\w.]+)\.(BackgroundColor3|TextColor3|ImageColor3)\s*=\s*Color3\.fromRGB\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)", line)
            if match and all(self._is_number(value) for value in match.groups()[2:]):
                object_name, property_name, red, green, blue = match.groups()
                components = [self._legacy_color_component(value) for value in (red, green, blue)]
                add(
                    "ConstructColor3",
                    "Construct Color3",
                    ESC + "R" + ESC + "1" + ESC + components[0] + ESC + "Number" + ESC + "G" + ESC + "1" + ESC + components[1] + ESC + "Number" + ESC + "B" + ESC + "1" + ESC + components[2] + ESC + "Number",
                    ESC + "Color3" + ESC + "_color0",
                )
                add(
                    "SetObjectProperty",
                    "Set Object Property",
                    ESC + "Value" + ESC + "2" + ESC + "_color0" + ESC + "Property" + ESC + "0" + ESC + property_name + ESC + "Object" + ESC + "0" + ESC + object_name,
                )
                continue
            match = re.fullmatch(r"([\w.]+)\.(BackgroundColor3|TextColor3|ImageColor3)\s*=\s*Color3\.new\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)", line)
            if match and all(self._is_number(value) for value in match.groups()[2:]):
                object_name, property_name, red, green, blue = match.groups()
                components = [_hex_number(value) for value in (red, green, blue)]
                add(
                    "ConstructColor3",
                    "Construct Color3",
                    ESC + "R" + ESC + "1" + ESC + components[0] + ESC + "Number" + ESC + "G" + ESC + "1" + ESC + components[1] + ESC + "Number" + ESC + "B" + ESC + "1" + ESC + components[2] + ESC + "Number",
                    ESC + "Color3" + ESC + "_color0",
                )
                add(
                    "SetObjectProperty",
                    "Set Object Property",
                    ESC + "Value" + ESC + "2" + ESC + "_color0" + ESC + "Property" + ESC + "0" + ESC + property_name + ESC + "Object" + ESC + "0" + ESC + object_name,
                )
                continue
            match = re.fullmatch(r"([\w.]+)\.CFrame\s*=\s*CFrame\.new\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)", line)
            if match and all(self._is_number(value) for value in match.groups()[1:]):
                object_name, x, y, z = match.groups()
                add(
                    "ConstructCFrame",
                    "CFrame",
                    ESC + "Rotation" + ESC + "0" + ESC + "0,0,0" + ESC + "Position" + ESC + "0" + ESC + ",".join(value.strip() for value in (x, y, z)),
                    ESC + "CFrame" + ESC + "_cframe0",
                )
                add(
                    "SetObjectProperty",
                    "Set Object Property",
                    ESC + "Value" + ESC + "2" + ESC + "_cframe0" + ESC + "Property" + ESC + "0" + ESC + "CFrame" + ESC + "Object" + ESC + "0" + ESC + object_name,
                )
                continue
            match = re.fullmatch(r"([\w.]+)\.(\w+)\s*=\s*Vector3\.new\s*\(\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^)]+)\s*\)", line)
            if match and all(self._is_number(value) for value in match.groups()[2:]):
                object_name, property_name, x, y, z = match.groups()
                add(
                    "ConstructVector3",
                    "Vector3",
                    ESC + "X" + _typed_value(x) + ESC + "Y" + _typed_value(y) + ESC + "Z" + _typed_value(z),
                    ESC + "Vector3" + ESC + "_vector0",
                )
                add(
                    "SetObjectProperty",
                    "Set Object Property",
                    ESC + "Value" + ESC + "2" + ESC + "_vector0" + ESC + "Property" + ESC + "0" + ESC + property_name + ESC + "Object" + ESC + "0" + ESC + object_name,
                )
                continue
            match = re.fullmatch(r"([\w.]+)\.BrickColor\s*=\s*BrickColor\.new\s*\(\s*(['\"])(.*?)\2\s*\)", line)
            if match:
                add(
                    "SetObjectProperty",
                    "Set Object Property",
                    ESC + "Value" + _typed_value(f'"{match.group(3)}"') + ESC + "Property" + ESC + "0" + ESC + "BrickColor" + ESC + "Object" + ESC + "0" + ESC + match.group(1),
                )
                continue
            match = re.fullmatch(r"([\w.]+)\.Material\s*=\s*Enum\.Material\.(\w+)", line)
            if match:
                add(
                    "SetObjectProperty",
                    "Set Object Property",
                    ESC + "Value" + _typed_value(f'"{match.group(2)}"') + ESC + "Property" + ESC + "0" + ESC + "Material" + ESC + "Object" + ESC + "0" + ESC + match.group(1),
                )
                continue
            match = re.fullmatch(r"([\w.]+)\.(\w+)\s*=\s*(.+)", line)
            if match and self._is_simple_value(match.group(3)):
                add(
                    "SetObjectProperty",
                    "Set Object Property",
                    ESC
                    + "Value"
                    + _typed_value(match.group(3))
                    + ESC
                    + "Property"
                    + ESC
                    + "0"
                    + ESC
                    + match.group(2)
                    + ESC
                    + "Object"
                    + ESC
                    + "0"
                    + ESC
                    + match.group(1),
                )
                continue
            match = re.fullmatch(r"(\w+)\s*\[\s*(.+)\s*\]\s*=\s*(.+)", line)
            if match and self._is_simple_value(match.group(2)) and self._is_simple_value(match.group(3)):
                add(
                    "SetTableValue",
                    "Set Table Value",
                    ESC + "Value" + _typed_value(match.group(3)) + ESC + "Key" + _typed_value(match.group(2)) + ESC + "Table" + ESC + "0" + ESC + match.group(1),
                )
                continue
            skipped.append(f"Skip: {line[:72]}")

        def ordered(block: LegacyBlock) -> list[LegacyBlock]:
            emitted: list[LegacyBlock] = []
            children = control_children.get(block.name, [])
            else_children = else_control_children.get(block.name, [])
            if block.type == "WhileLoop3" and children:
                emitted.extend(ordered(children[0]))
                emitted.append(block)
                for child in children[1:]:
                    emitted.extend(ordered(child))
                return emitted
            for child in children:
                emitted.extend(ordered(child))
            for child in else_children:
                emitted.extend(ordered(child))
            emitted.append(block)
            return emitted

        def link_sequence(sequence: list[LegacyBlock]) -> None:
            for index, block in enumerate(sequence):
                block.child = sequence[index + 1].name if index + 1 < len(sequence) else None
                children = control_children.get(block.name, [])
                if children:
                    block.child = children[0].name
                    link_sequence(children)
                else_children = else_control_children.get(block.name, [])
                if else_children:
                    block.else_child = else_children[0].name
                    link_sequence(else_children)

        link_sequence(top_level_blocks)
        blocks = []
        index = 0
        while index < len(top_level_blocks):
            block = top_level_blocks[index]
            next_block = top_level_blocks[index + 1] if index + 1 < len(top_level_blocks) else None
            if next_block and next_block.type == "WhileLoop3" and next_block.name in numeric_loop_steps:
                loop_children = control_children.get(next_block.name, [])
                if loop_children:
                    blocks.extend(ordered(loop_children[0]))
                    blocks.append(block)
                    blocks.append(next_block)
                    for child in loop_children[1:]:
                        blocks.extend(ordered(child))
                    index += 2
                    continue
            blocks.extend(ordered(block))
            index += 1
        for index, block in enumerate(blocks):
            block.position = _position(index)

        root_target = top_level_blocks[0].name if top_level_blocks else None
        root_inputs = ESC + "Color" + ESC + "0" + ESC + "3FC" + ESC + "Comment" + ESC + "0" + ESC + "ROOT"
        root = LegacyBlock("Comment2", "ROOT", "-10.0,-10.0", root_inputs, "", root_target)
        serialized = _editor() + _serialize_block(root) + "".join(_serialize_block(block) for block in blocks)
        return Compilation(
            serialized=serialized,
            encoded=encode_envelope(serialized),
            blocks=len(blocks),
            skipped_features=tuple(skipped),
        )

    @staticmethod
    def _is_simple_value(value: str) -> bool:
        return bool(
            re.fullmatch(
                r"(?:-?(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d[\d_]*)?)|true|false|nil|['\"][^'\"]*['\"]|[\w.]+)",
                value.strip(),
            )
        )

    @staticmethod
    def _normalize_modern_luau(source: str) -> str:
        normalized = source.replace("\r\n", "\n").replace("\r", "\n")
        normalized = re.sub(r"^\s*--![^\n]*$", "", normalized, flags=re.MULTILINE)
        normalized = re.sub(r"\bconst\s+(\w+)(?:\s*:\s*[^=\n]+)?\s*=", r"local \1 =", normalized)
        normalized = re.sub(r"\blocal\s+(\w+)\s*:\s*[^=\n]+\s*=", r"local \1 =", normalized)
        return normalized

    @staticmethod
    def _condition_inputs(expression: str) -> str:
        comparison = re.fullmatch(r"(.+?)\s*(==|~=|>=|<=|>|<)\s*(.+)", expression.strip())
        if comparison:
            left, operator, right = comparison.groups()
            return ESC + "Value 1" + _typed_value(left) + ESC + "Value 2" + _typed_value(right) + ESC + "ComparisonType" + ESC + "0" + ESC + operator
        return ESC + "Value 1" + _typed_value(expression) + ESC + "Value 2" + _typed_value("true") + ESC + "ComparisonType" + ESC + "0" + ESC + "=="

    @staticmethod
    def _is_number(value: str) -> bool:
        return bool(re.fullmatch(r"-?(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|\d[\d_]*(?:\.\d[\d_]*)?)", value.strip()))

    @staticmethod
    def _rgb_component(value: str) -> str:
        normalized = value.strip().replace("_", "")
        integer = int(normalized, 0) if normalized.lower().startswith(("0x", "0b")) else int(float(normalized))
        integer = max(0, min(255, integer))
        return format(integer, "02X")

    @staticmethod
    def _legacy_color_component(value: str) -> str:
        normalized = value.strip().replace("_", "")
        integer = int(normalized, 0) if normalized.lower().startswith(("0x", "0b")) else int(float(normalized))
        integer = max(0, min(255, integer))
        if integer in {0, 255}:
            return str(integer // 255)
        numerator, denominator = (integer / 255).as_integer_ratio()
        digits: list[str] = []
        while numerator:
            numerator *= 16
            digit, numerator = divmod(numerator, denominator)
            digits.append(format(digit, "X"))
        return "0." + "".join(digits)

    @staticmethod
    def _strip_trailing_comment(line: str) -> str:
        quote: str | None = None
        for index in range(len(line) - 1):
            character = line[index]
            if character in "'\"":
                quote = None if quote == character else character if quote is None else quote
            if quote is None and line[index : index + 2] == "--":
                return line[:index].strip()
        return line

    @staticmethod
    def _parse_overrides(raw: str) -> dict[str, str]:
        if not raw.strip():
            return {}
        overrides: dict[str, str] = {}
        for item in raw.split(","):
            key, separator, value = item.partition("=")
            if not separator or not key.strip() or not value.strip():
                raise ValueError("Invalid catalog override")
            overrides[key.strip()] = value.strip()
        return overrides

    @staticmethod
    def _catalog_inputs(template_inputs: str, overrides: dict[str, str]) -> str:
        tokens = template_inputs.split(ESC)
        position = 1
        rebuilt = ""
        while position < len(tokens) and tokens[position] != "":
            field = tokens[position]
            kind = tokens[position + 1] if position + 1 < len(tokens) else "0"
            value = tokens[position + 2] if position + 2 < len(tokens) else ""
            position += 3
            type_name = ""
            if kind == "1" and position < len(tokens):
                type_name = tokens[position]
                position += 1
            override = overrides.get(field)
            if override is not None:
                if kind == "0":
                    value = override[1:-1] if len(override) >= 2 and override[0] in "'\"" and override[-1] == override[0] else override
                else:
                    typed = _typed_value(override).split(ESC)
                    kind = typed[1]
                    value = typed[2]
                    type_name = typed[3] if len(typed) > 3 else ""
            rebuilt += ESC + field + ESC + kind + ESC + _escape_value(value)
            if kind == "1" and type_name:
                rebuilt += ESC + _escape_value(type_name)
        return rebuilt
