# knowledge.search

Локальный инструмент Python для S-2 и повторного использования ответа S-6.
Не входит в шесть Go MCP tools. Вход модели: query; user_id/team_id/role не задаются моделью.

Перед каждым поиском Python вызывает POST /mcp/knowledge-scope с service token и
X-Request-ID. Go проверяет активность генерации, пользователя, команды и роль intern;
Python сверяет возвращённую область. При отказе поиск не выполняется.

Поиск использует published/ready документы своей команды и актуальные чанки редакции.
Seed имеет отдельные командные копии. Перед поиском индексируются новые ответы наставника.
Ответ found содержит results с текстом, score и source; публичный источник содержит
UUID document_id, revision, title, section и url. При пустом результате status=no_answer,
who_to_ask и suggest_escalation. Предложение помощи не означает выполненную эскалацию.

KB_TOP_K=4, KB_MIN_SCORE по умолчанию 0.80; порог требует калибровки. Модель E5,
768 измерений. Go повторно проверяет доступ к источникам при сохранении ответа.
HTTP GET /knowledge/search - отдельный полнотекстовый поиск Go для интерфейса.

Реализация: [инструмент](../../ai-service/app/agent/knowledge_tool.py),
[поиск](../../ai-service/app/rag/search.py). Формат источников: [Go/Python](../../docs/ai-contract.md).
