"""Подбор порога KB_MIN_SCORE на реальной модели (без БД).

Запуск из папки ai-service:  py scripts/calibrate_threshold.py
Скрипт печатает лучший score для вопросов с ответом и без ответа
и предлагает порог между ними.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.rag.chunker import build_chunks  # noqa: E402
from app.rag.embeddings import E5Embedder  # noqa: E402
from app.rag.search import search  # noqa: E402
from app.rag.store import ChunkRow, MemoryStore  # noqa: E402

KB_DIR = (
    Path(sys.argv[1])
    if len(sys.argv) > 1
    else Path(__file__).resolve().parents[2] / "seed" / "kb"
)

# TODO: заменить вопросами из tests/eval/questions.md (Саша)
WITH_ANSWER = [
    "Как оформить отгул?",
    "Как взять выходной в пятницу?",
    "Как проходит code review?",
    "Как запустить проект локально?",
    "Кто согласует заявки?",
    "Как часто встречи с наставником?",
    "Что делать, если задача заблокирована?",
    "Как открыть первый pull request?",
    "К кому идти с вопросом?",
    "Как получить доступ к репозиторию?",
    "Как проходят дежурства?",
    "Как устроены релизы?",
    "Когда проходит стендап?",
    "Где найти материалы для обучения?",
    "Можно ли отправлять код во внешние ИИ-сервисы?",
]
WITHOUT_ANSWER = [
    "Какой бюджет на конференции?",
    "Какая зарплата у стажёра?",
    "Какой дресс-код в офисе?",
    "Где находится столовая?",
    "Сколько дней отпуска в году?",
]


def best(q, emb, store):
    res = search(q, None, embedder=emb, store=store, top_k=1, min_score=-1.0)
    return (res[0].score, res[0].source_label) if res else (0.0, "-")


def main():
    emb = E5Embedder()
    chunks = build_chunks(KB_DIR, 800, 80)
    vecs = emb.embed_passages([c.embed_text for c in chunks])
    store = MemoryStore()
    store.replace_source(
        "seed",
        [ChunkRow(c.doc_title, c.section, c.text, v) for c, v in zip(chunks, vecs)],
    )
    print(
        f"чанков: {len(chunks)}, "
        f"самый длинный: {max(len(c.text) for c in chunks)} символов\n",
    )

    pos = [best(q, emb, store) for q in WITH_ANSWER]
    neg = [best(q, emb, store) for q in WITHOUT_ANSWER]
    print("С ОТВЕТОМ:")
    for q, (s, src) in zip(WITH_ANSWER, pos):
        print(f"  {s:.3f}  {q}  ->  {src}")
    print("БЕЗ ОТВЕТА:")
    for q, (s, src) in zip(WITHOUT_ANSWER, neg):
        print(f"  {s:.3f}  {q}  ->  {src}")

    lo, hi = min(s for s, _ in pos), max(s for s, _ in neg)
    print(f"\nмин. с ответом: {lo:.3f}, макс. без ответа: {hi:.3f}")
    if lo > hi:
        print(f"Предлагаемый KB_MIN_SCORE = {(lo + hi) / 2:.3f}")
    else:
        print(
            "Оценки пересекаются: один порог не разделит. Смотри вопросы выше "
            "(добавь синонимы в документы или усили запрос).",
        )


if __name__ == "__main__":
    main()
