from app.rag.chunker import build_chunks, chunk_document, parse_document, split_with_overlap

DOC = """> **Тестовая инструкция, не регламент Авито.**

# Заголовок

## Раздел один
Короткий текст.

## Раздел два
Ещё текст.
"""


def test_parse_strips_banner_and_reads_sections():
    title, sections = parse_document(DOC)
    assert title == "Заголовок"
    assert [h for h, _ in sections] == ["Раздел один", "Раздел два"]
    assert all("Тестовая инструкция" not in b for _, b in sections)


def test_short_section_is_one_chunk():
    chunks = chunk_document(DOC, "x", 800, 80)
    assert len(chunks) == 2
    assert chunks[0].doc_title == "Заголовок" and chunks[0].section == "Раздел один"


def test_long_section_split_with_overlap():
    text = " ".join(f"слово{i}" for i in range(300))
    parts = split_with_overlap(text, 200, 80)
    assert len(parts) > 2
    assert all(len(p) <= 200 for p in parts)
    for a, b in zip(parts, parts[1:]):
        tail = a[-40:]
        assert b[:30] in a, "нет перекрытия между соседними частями"
        assert len(tail) > 0


def test_split_rejects_bad_overlap():
    import pytest

    with pytest.raises(ValueError):
        split_with_overlap("а " * 500, 100, 80)


def test_seed_docs(kb_dir):
    files = sorted(kb_dir.glob("*.md"))
    assert len(files) >= 1
    for f in files:
        text = f.read_text(encoding="utf-8")
        assert text.splitlines()[0].startswith("> **Тестовая инструкция, не регламент Авито"), f.name
        assert "\u2014" not in text, f"длинное тире в {f.name}"
    chunks = build_chunks(kb_dir, 800, 80)
    assert chunks and all(c.text.strip() and len(c.text) <= 800 for c in chunks)
