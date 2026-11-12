"""Контекст пользователя для системного промпта (данные от backend)."""

from __future__ import annotations

import re
from dataclasses import dataclass

ROLE_LABELS = {"intern": "стажёр", "buddy": "наставник", "lead": "руководитель"}


def clean(value, limit: int = 80) -> str:
    """Одна строка без управляющих символов и переводов строк, обрезанная до limit."""
    text = re.sub(r"[\x00-\x1f\x7f]+", " ", str(value or ""))
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


@dataclass(frozen=True)
class NextStep:
    title: str
    deadline: str | None = None


@dataclass(frozen=True)
class UserContext:
    user_id: str
    role: str
    team_id: str | None
    name: str = ""
    team_name: str | None = None
    stage: str | None = None
    tasks_done: int | None = None
    tasks_total: int | None = None
    next_step: NextStep | None = None

    @classmethod
    def from_payload(cls, p: dict) -> "UserContext":
        """Поля name, team_name, progress, next_step добавить в docs/ai-contract.md."""
        ns = p.get("next_step") or None
        progress = p.get("progress") or {}
        return cls(
            user_id=str(p.get("user_id", "")),
            role=str(p.get("role", "intern")),
            team_id=None if p.get("team_id") is None else str(p["team_id"]),
            name=clean(p.get("name")),
            team_name=clean(p.get("team_name")) or None,
            stage=clean(p.get("stage")) or None,
            tasks_done=progress.get("done"),
            tasks_total=progress.get("total"),
            next_step=(
                NextStep(clean(ns.get("title"), 160), clean(ns.get("deadline")) or None)
                if ns
                else None
            ),
        )
