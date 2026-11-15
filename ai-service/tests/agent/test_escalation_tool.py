from app.agent.escalation_tool import proposal_details


def test_proposal_without_history_uses_current_question():
    assert proposal_details("  Нужен совет  ") == {
        "question": "Нужен совет",
        "context_snapshot": [],
    }


def test_transfer_request_uses_previous_user_question_and_trusted_snapshot():
    history = [
        {
            "message_id": f"30000000-0000-0000-0000-{index:012d}",
            "role": "user" if index % 2 == 0 else "assistant",
            "content": f"Сообщение {index}",
            "sources": [
                {
                    "document_id": "40000000-0000-0000-0000-000000000001",
                    "revision": 2,
                    "title": "Гайд",
                    "section": "Раздел",
                    "url": "kb/guide",
                },
            ],
        }
        for index in range(11)
    ]
    history.insert(0, {"role": "user", "content": "Сообщение без доверенного ID"})

    result = proposal_details("Передай вопрос наставнику", history)

    assert result["question"] == "Сообщение 10"
    assert len(result["context_snapshot"]) == 10
    assert result["context_snapshot"][0]["message_id"].endswith("000000000001")
    assert result["context_snapshot"][-1]["sources"][0]["revision"] == 2
