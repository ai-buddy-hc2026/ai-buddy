from app.agent.context import UserContext
from app.agent.unknown import escalation_proposal, unknown_answer_text, who_to_ask

INTERN = UserContext(user_id="u1", role="intern", team_id="t1")


def test_contacts_by_role():
    assert who_to_ask("intern") == ["наставник", "руководитель", "HR BP"]
    assert who_to_ask("buddy") == ["руководитель", "HR BP"]
    assert who_to_ask("lead") == ["HR BP"]


def test_unknown_text_for_intern_has_button_hint():
    t = unknown_answer_text("intern")
    assert "наставник" in t and "HR BP" in t and "Передать наставнику" in t


def test_unknown_text_for_buddy_has_no_button():
    assert "Передать наставнику" not in unknown_answer_text("buddy")


def test_proposal_for_intern_trims_history():
    hist = [{"role": "user", "content": f"м{i}"} for i in range(10)]
    p = escalation_proposal("Какой бюджет?", INTERN, hist)
    assert p["action"] == "escalation.create" and p["type"] == "action_proposal"
    assert (
        len(p["payload"]["context"]) == 6 and p["payload"]["question"] == "Какой бюджет?"
    )


def test_no_proposal_for_non_intern():
    assert (
        escalation_proposal("q", UserContext(user_id="b", role="buddy", team_id="t"), [])
        is None
    )
