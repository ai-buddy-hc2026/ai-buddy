"""Обновить встроенные схемы: python specs/mcp/generate.py из корня репозитория."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
bundle = json.loads((root / "specs/mcp/schemas.json").read_text(encoding="utf-8"))
body = json.dumps(bundle, ensure_ascii=False, separators=(",", ":"))
assert "`" not in body
(root / "backend/internal/toolcontract/schema_data.go").write_text(
    "// Code generated from specs/mcp/schemas.json; DO NOT EDIT.\n"
    "package toolcontract\n\nconst schemaData = `" + body + "`\n",
    encoding="utf-8",
)
