# escalation.create

Целевая операция S-5, внутренний исполнитель Go реализован. В MCP-профиле не
опубликована, Python-предложения не принимаются. Полный путь из чата не завершён.

Исполнитель принимает action_id подтверждённого действия. Параметры: buddy_id,
question и context_snapshot с message_id, role, content, sources. Все внутренние
ID - UUID. Только intern за себя, получатель - актуальный назначенный buddy своей команды.
До 10 выбранных сообщений, суммарно до 20000 символов; вопрос до 4000 символов.
Go сверяет снимок с сохранённой беседой. Непустые sources в снимке пока запрещены.
Результат: id (UUID), status=open, buddy_id (UUID). Повтор не создаёт дубль.

Подробности: [действия](../../docs/activity.md). Ответ наставника:
POST /buddy/escalations/{id}/answer с version, answer_text, add_to_kb.
Наличие Python helper escalation_proposal не означает включённый сценарий S-5.
