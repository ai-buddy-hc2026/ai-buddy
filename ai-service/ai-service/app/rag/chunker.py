"""Чанкинг Markdown по заголовкам с перекрытием для длинных разделов."""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

BANNER_MARK = "Тестовая инструкция"


@dataclass(frozen=True)
class Chunk:
    doc_title: str
    section: str
    text: str
    part: int = 0

    @property
    def embed_text(self) -> str:
        """Текст для эмбеддинга: название и раздел помогают поиску."""
        return f"{self.doc_title}. {self.section}. {self.text}"


def parse_document(markdown: str, fallback_title: str = "Без названия"):
    """Возвращает (название документа, [(раздел, текст), ...]). Плашка убирается."""
    title = fallback_title
    sections: list[list] = []
    current: list = ["Введение", []]
    for line in markdown.splitlines():
        stripped = line.strip()
        if stripped.startswith(">") and BANNER_MARK in stripped:
            continue
        if re.match(r"^#\s+", stripped):
            title = stripped[1:].strip()
            continue
        m = re.match(r"^#{2,3}\s+(.*)", stripped)
        if m:
            sections.append(current)
            current = [m.group(1).strip(), []]
            continue
        current[1].append(line)
    sections.append(current)
    result = []
    for heading, lines in sections:
        body = "\n".join(lines).strip()
        if body:
            result.append((heading, body))
    return title, result


def split_with_overlap(text: str, max_chars: int, overlap: int) -> list[str]:
    """Режет длинный текст на части до max_chars с перекрытием около overlap символов."""
    text = text.strip()
    if len(text) <= max_chars:
        return [text] if text else []
    if max_chars < 2 * overlap:
        raise ValueError("max_chars должен быть не меньше 2 * overlap")
    parts: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + max_chars, len(text))
        if end < len(text):
            window_start = start + max_chars // 2
            cut = max(text.rfind("\n", window_start, end), text.rfind(". ", window_start, end))
            if cut == -1:
                cut = text.rfind(" ", window_start, end)
            if cut != -1:
                end = cut + 1
        piece = text[start:end].strip()
        if piece:
            parts.append(piece)
        if end >= len(text):
            break
        nxt = end - overlap
        space = text.find(" ", nxt, end)
        if space != -1:
            nxt = space + 1
        start = max(nxt, start + 1)
    return parts


def chunk_document(markdown: str, fallback_title: str, max_chars: int, overlap: int) -> list[Chunk]:
    title, sections = parse_document(markdown, fallback_title)
    chunks: list[Chunk] = []
    for heading, body in sections:
        for i, part in enumerate(split_with_overlap(body, max_chars, overlap)):
            chunks.append(Chunk(doc_title=title, section=heading, text=part, part=i))
    return chunks


def build_chunks(kb_dir: Path, max_chars: int = 800, overlap: int = 80) -> list[Chunk]:
    chunks: list[Chunk] = []
    for path in sorted(Path(kb_dir).glob("*.md")):
        text = path.read_text(encoding="utf-8")
        chunks.extend(chunk_document(text, path.stem, max_chars, overlap))
    return chunks
