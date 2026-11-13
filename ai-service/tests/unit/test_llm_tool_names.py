import re

from core.ai_service import from_llm_tool_name, to_llm_tool_name

OPENAI_NAME_PATTERN = re.compile(r"^[a-zA-Z0-9_-]+$")
MCP_TOOL_NAMES = [
    "checklist.get_plan",
    "checklist.update_status",
    "employees.get_manager",
    "absences.get_policy",
    "absences.create_request",
    "absences.list_for_employee",
]


def test_llm_tool_names_match_openai_pattern():
    for name in MCP_TOOL_NAMES:
        assert OPENAI_NAME_PATTERN.match(to_llm_tool_name(name))


def test_llm_tool_name_round_trip_restores_mcp_name():
    for name in MCP_TOOL_NAMES:
        assert from_llm_tool_name(to_llm_tool_name(name)) == name


def test_from_llm_tool_name_keeps_dotted_name():
    assert from_llm_tool_name("checklist.get_plan") == "checklist.get_plan"
