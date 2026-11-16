from datetime import date

from app.rag.chunker import chunk_document, parse_freshness
from app.rag.ingest import ingest_seed_documents

DOC = """> **Тестовая инструкция, не регламент Авито.**
> Владелец: наставник команды. Проверено: 2026-10-20.

# Отгул

## Сроки
За 3 рабочих дня.
"""


def test_parse_freshness_reads_owner_and_date():
    assert parse_freshness(DOC) == ("наставник команды", date(2026, 10, 20))


def test_parse_freshness_without_meta():
    assert parse_freshness("# Док\n\nтекст") == (None, None)


def test_parse_freshness_ignores_invalid_date():
    owner, reviewed = parse_freshness("> Владелец: HR BP. Проверено: 2026-13-45.\n# Д")
    assert owner == "HR BP" and reviewed is None


def test_meta_line_is_not_indexed():
    chunks = chunk_document(DOC, "x", 800, 80)
    assert all("Владелец" not in c.text and "Проверено" not in c.text for c in chunks)


def test_every_seed_document_has_owner_and_review_date(kb_dir):
    for path in kb_dir.glob("*.md"):
        owner, reviewed = parse_freshness(path.read_text(encoding="utf-8"))
        assert owner and reviewed, path.name


def test_seed_ingest_passes_freshness_to_documents_and_rows(kb_dir, embedder):
    class Store:
        def __init__(self):
            self.meta = []
            self.rows = []

        def active_team_ids(self):
            return ["team-a"]

        def prepare_seed_document(self, team_id, slug, title, content, **meta):
            self.meta.append(meta)
            return f"{team_id}-{slug}", 1

        def replace_document_chunks(self, document_id, team_id, revision, slug, rows):
            self.rows.extend(rows)

    store = Store()
    ingest_seed_documents(kb_dir, embedder, store, max_chars=800, overlap=80)
    assert all(m["owner"] and m["reviewed_at"] for m in store.meta)
    assert all(r.owner and r.reviewed_at and r.slug for r in store.rows)


def test_glossary_document_exists(kb_dir):
    text = (kb_dir / "15-glossary.md").read_text(encoding="utf-8")
    assert text.startswith("> **Тестовая инструкция")
    for term in ("PR", "Ревью", "Дежурство", "Релиз", "Онбординг"):
        assert term in text
