from app.rag.chunker import build_chunks
from app.rag.search import search
from app.rag.store import ChunkRow, MemoryStore

# Пороги для фейкового эмбеддера. Для реальной модели порог другой (KB_MIN_SCORE).
FAKE_MIN = 0.35


def make_store(kb_dir, embedder):
    chunks = build_chunks(kb_dir, 800, 80)
    vecs = embedder.embed_passages([c.embed_text for c in chunks])
    store = MemoryStore()
    store.replace_source(
        "seed",
        [ChunkRow(c.doc_title, c.section, c.text, v) for c, v in zip(chunks, vecs)],
    )
    return store


def test_otgul_question_finds_otgul_doc(kb_dir, embedder):
    store = make_store(kb_dir, embedder)
    res = search(
        "Как оформить отгул?",
        "team-a",
        embedder=embedder,
        store=store,
        min_score=FAKE_MIN,
    )
    assert res is not None
    assert res[0].source_label.startswith(res[0].doc_title)


def test_budget_question_finds_nothing(kb_dir, embedder):
    store = make_store(kb_dir, embedder)
    res = search(
        "Какой бюджет на конференции?",
        "team-a",
        embedder=embedder,
        store=store,
        min_score=FAKE_MIN,
    )
    assert res == []


def test_top_k_limit(kb_dir, embedder):
    store = make_store(kb_dir, embedder)
    res = search(
        "code review pull request ревьюер",
        "team-a",
        embedder=embedder,
        store=store,
        top_k=4,
        min_score=0.0,
    )
    assert len(res) == 4


def test_empty_query(kb_dir, embedder):
    store = make_store(kb_dir, embedder)
    assert search("   ", "team-a", embedder=embedder, store=store) == []


def test_team_filter(embedder):
    store = MemoryStore()
    v = embedder.embed_passages(["секретный ответ наставника про бюджет"])[0]
    store.add(
        "mentor_answer",
        [
            ChunkRow(
                "Ответ наставника", "Бюджет", "секретный ответ", v, team_id="team-a"
            )
        ],
    )
    q = "бюджет"
    own = search(q, "team-a", embedder=embedder, store=store, min_score=0.0)
    other = search(q, "team-b", embedder=embedder, store=store, min_score=0.0)
    no_team = search(q, None, embedder=embedder, store=store, min_score=0.0)
    assert len(own) == 1 and own[0].source == "mentor_answer"
    assert other == [] and no_team == []


def test_replace_source_is_idempotent(kb_dir, embedder):
    store = make_store(kb_dir, embedder)
    n1 = len(store.query(embedder.embed_query("отгул"), "t", 1000))
    chunks = build_chunks(kb_dir, 800, 80)
    vecs = embedder.embed_passages([c.embed_text for c in chunks])
    store.replace_source(
        "seed",
        [ChunkRow(c.doc_title, c.section, c.text, v) for c, v in zip(chunks, vecs)],
    )
    assert len(store.query(embedder.embed_query("отгул"), "t", 1000)) == n1
