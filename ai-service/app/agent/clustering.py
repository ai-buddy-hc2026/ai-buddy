"""Группировка вопросов без ответа (идея 37): простая лексическая кластеризация.

Без модели и сети: нормализуем слова, обрезаем до основы и объединяем вопросы,
у которых похожий набор основ (коэффициент Жаккара, одиночная связь).
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass

DEFAULT_THRESHOLD = 0.34
STEM_CHARS = 5
_WORD = re.compile(r"[a-zа-я0-9]+")
STOPWORDS = frozenset(
    """
    а без бы в во вот где да для до если есть еще же за и из или к как какая
    какие какой когда кому кто куда ли мне мной можно мы на над надо не нет ни
    но нужно о об от по под при про с со так там то тут у уже чем что чтобы
    это эту я ты вы мой моя мои меня тебя нам вам их его ее
    the a an is are to of in on for how what where who
    """.split(),
)


@dataclass(frozen=True)
class Question:
    id: str | None
    text: str


@dataclass(frozen=True)
class Cluster:
    label: str
    questions: tuple[Question, ...]

    @property
    def size(self) -> int:
        return len(self.questions)


def normalize(text: str) -> frozenset[str]:
    words = _WORD.findall(text.lower().replace("ё", "е"))
    return frozenset(w[:STEM_CHARS] for w in words if w not in STOPWORDS)


def _similarity(a: frozenset[str], b: frozenset[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _medoid(indexes: list[int], tokens: list[frozenset[str]]) -> int:
    """Самый «центральный» вопрос группы становится её названием."""
    return max(
        indexes,
        key=lambda i: (sum(_similarity(tokens[i], tokens[j]) for j in indexes), -i),
    )


def cluster_questions(
    items: Iterable[tuple[str | None, str]],
    threshold: float = DEFAULT_THRESHOLD,
) -> list[Cluster]:
    questions = [Question(qid, text.strip()) for qid, text in items]
    tokens = [normalize(q.text) for q in questions]
    groups: list[list[int]] = []
    for i, current in enumerate(tokens):
        matched = [
            g
            for g in groups
            if any(_similarity(current, tokens[j]) >= threshold for j in g)
        ]
        if not matched:
            groups.append([i])
            continue
        merged = sorted({j for g in matched for j in g} | {i})
        groups = [g for g in groups if g not in matched] + [merged]
    groups.sort(key=lambda g: (-len(g), g[0]))
    return [
        Cluster(
            label=questions[_medoid(g, tokens)].text,
            questions=tuple(questions[i] for i in g),
        )
        for g in groups
    ]
