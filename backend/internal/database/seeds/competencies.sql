-- Синтетические матрицы компетенций для треков backend и frontend. Существующие записи сохраняются.
INSERT INTO competencies (track, code, name_ru, name_en, position) VALUES
    ('backend', 'go', 'Go и стандартная библиотека', 'Go and the standard library', 1),
    ('backend', 'tests', 'Тесты', 'Testing', 2),
    ('backend', 'review', 'Code review', 'Code review', 3),
    ('backend', 'sql', 'SQL и базы данных', 'SQL and databases', 4),
    ('backend', 'api', 'Проектирование API', 'API design', 5),
    ('backend', 'infra', 'CI, деплой, k8s', 'CI, deploy, k8s', 6),
    ('backend', 'comms', 'Коммуникация в команде', 'Team communication', 7),
    ('frontend', 'ts', 'TypeScript', 'TypeScript', 1),
    ('frontend', 'react', 'React и состояние', 'React and state', 2),
    ('frontend', 'layout', 'Вёрстка и доступность', 'Layout and accessibility', 3),
    ('frontend', 'tests', 'Тесты', 'Testing', 4),
    ('frontend', 'review', 'Code review', 'Code review', 5),
    ('frontend', 'perf', 'Производительность', 'Performance', 6),
    ('frontend', 'comms', 'Коммуникация в команде', 'Team communication', 7)
ON CONFLICT (track, code) DO NOTHING;

INSERT INTO competency_levels (competency_id, level, description_ru, description_en)
SELECT c.id, v.level, v.ru, v.en FROM (VALUES
    ('backend', 'go', 1, 'Читаю код сервиса и запускаю его локально', 'I read the service code and run it locally'),
    ('backend', 'go', 2, 'Пишу ручку по образцу, ошибки обрабатываю с подсказкой', 'I write a handler from an example, handle errors with help'),
    ('backend', 'go', 3, 'Сама пишу пакет с контекстом, ошибками и горутинами', 'I write a package with context, errors and goroutines on my own'),
    ('backend', 'go', 4, 'Объясняю идиомы Go и ревьюю чужой код', 'I explain Go idioms and review others'' code'),
    ('backend', 'tests', 1, 'Запускаю существующие тесты', 'I run existing tests'),
    ('backend', 'tests', 2, 'Дописываю табличный тест по образцу', 'I add a table test from an example'),
    ('backend', 'tests', 3, 'Покрываю свой код тестами, включая ошибки и границы', 'I cover my code with tests, including errors and edge cases'),
    ('backend', 'tests', 4, 'Строю тестовую инфраструктуру и учу других', 'I build test infrastructure and teach others'),
    ('backend', 'review', 1, 'Читаю комментарии к своему MR и исправляю', 'I read comments on my MR and fix them'),
    ('backend', 'review', 2, 'Готовлю MR с понятным описанием, проходит за 2-3 круга', 'I prepare an MR with a clear description, it passes in 2-3 rounds'),
    ('backend', 'review', 3, 'Мои MR проходят за 1-2 круга, оставляю полезные комментарии', 'My MRs pass in 1-2 rounds, I leave useful comments'),
    ('backend', 'review', 4, 'Ревьюю MR команды и помогаю договориться', 'I review team MRs and help reach agreement'),
    ('backend', 'sql', 1, 'Пишу простой SELECT по готовой схеме', 'I write a simple SELECT against an existing schema'),
    ('backend', 'sql', 2, 'Пишу JOIN и миграцию по образцу', 'I write a JOIN and a migration from an example'),
    ('backend', 'sql', 3, 'Сама проектирую таблицу, индексы и транзакцию', 'I design a table, indexes and a transaction on my own'),
    ('backend', 'sql', 4, 'Разбираю планы запросов и учу других', 'I analyze query plans and teach others'),
    ('backend', 'api', 1, 'Вызываю готовые ручки по документации', 'I call existing endpoints from the docs'),
    ('backend', 'api', 2, 'Добавляю поле в контракт с подсказкой', 'I add a field to the contract with help'),
    ('backend', 'api', 3, 'Сама проектирую ручку: коды ответов, ошибки, совместимость', 'I design an endpoint on my own: status codes, errors, compatibility'),
    ('backend', 'api', 4, 'Веду контракт между сервисами и объясняю решения', 'I own the contract between services and explain decisions'),
    ('backend', 'infra', 1, 'Смотрю статус пайплайна и логи', 'I check pipeline status and logs'),
    ('backend', 'infra', 2, 'Чиню упавший шаг CI с подсказкой', 'I fix a failed CI step with help'),
    ('backend', 'infra', 3, 'Сама выкатываю сервис и откатываю при ошибке', 'I deploy the service and roll it back on my own'),
    ('backend', 'infra', 4, 'Настраиваю пайплайн и алерты для команды', 'I set up the pipeline and alerts for the team'),
    ('backend', 'comms', 1, 'Задаю вопросы в чате команды', 'I ask questions in the team chat'),
    ('backend', 'comms', 2, 'Пишу понятный статус: что сделала, что дальше, где застряла', 'I write a clear status: done, next, blocked'),
    ('backend', 'comms', 3, 'Сама договариваюсь о решении с другими командами', 'I agree on decisions with other teams on my own'),
    ('backend', 'comms', 4, 'Помогаю новичкам и веду обсуждения', 'I help newcomers and lead discussions'),
    ('frontend', 'ts', 1, 'Читаю типы и исправляю простые ошибки компилятора', 'I read types and fix simple compiler errors'),
    ('frontend', 'ts', 2, 'Описываю пропсы и данные по образцу', 'I type props and data from an example'),
    ('frontend', 'ts', 3, 'Сама пишу дженерики, union-типы и схемы валидации', 'I write generics, unions and validation schemas on my own'),
    ('frontend', 'ts', 4, 'Объясняю систему типов и ревьюю типизацию', 'I explain the type system and review typing'),
    ('frontend', 'react', 1, 'Меняю текст и стили в готовом компоненте', 'I change text and styles in an existing component'),
    ('frontend', 'react', 2, 'Собираю компонент по образцу с хуками', 'I build a component with hooks from an example'),
    ('frontend', 'react', 3, 'Сама разделяю состояние, загрузку данных и отображение', 'I split state, data loading and rendering on my own'),
    ('frontend', 'react', 4, 'Проектирую структуру фичи и учу других', 'I design feature structure and teach others'),
    ('frontend', 'layout', 1, 'Правлю отступы и цвета по макету', 'I adjust spacing and colors to a mockup'),
    ('frontend', 'layout', 2, 'Верстаю адаптивный блок с подсказкой', 'I build a responsive block with help'),
    ('frontend', 'layout', 3, 'Сама верстаю экран с клавиатурой и читалкой экрана', 'I build a screen with keyboard and screen reader support on my own'),
    ('frontend', 'layout', 4, 'Провожу аудит доступности и учу других', 'I run accessibility audits and teach others'),
    ('frontend', 'tests', 1, 'Запускаю существующие тесты', 'I run existing tests'),
    ('frontend', 'tests', 2, 'Дописываю тест логики по образцу', 'I add a logic test from an example'),
    ('frontend', 'tests', 3, 'Покрываю логику и компоненты тестами', 'I cover logic and components with tests'),
    ('frontend', 'tests', 4, 'Настраиваю тестовую инфраструктуру и учу других', 'I set up test infrastructure and teach others'),
    ('frontend', 'review', 1, 'Читаю комментарии к своему MR и исправляю', 'I read comments on my MR and fix them'),
    ('frontend', 'review', 2, 'Готовлю MR со скриншотами, проходит за 2-3 круга', 'I prepare an MR with screenshots, it passes in 2-3 rounds'),
    ('frontend', 'review', 3, 'Мои MR проходят за 1-2 круга, оставляю полезные комментарии', 'My MRs pass in 1-2 rounds, I leave useful comments'),
    ('frontend', 'review', 4, 'Ревьюю MR команды и помогаю договориться', 'I review team MRs and help reach agreement'),
    ('frontend', 'perf', 1, 'Открываю вкладку Performance в DevTools', 'I open the Performance tab in DevTools'),
    ('frontend', 'perf', 2, 'Нахожу лишние рендеры с подсказкой', 'I find extra renders with help'),
    ('frontend', 'perf', 3, 'Сама уменьшаю бандл и ускоряю медленный экран', 'I shrink the bundle and speed up a slow screen on my own'),
    ('frontend', 'perf', 4, 'Задаю бюджеты производительности для команды', 'I set performance budgets for the team'),
    ('frontend', 'comms', 1, 'Задаю вопросы в чате команды', 'I ask questions in the team chat'),
    ('frontend', 'comms', 2, 'Пишу понятный статус: что сделал, что дальше, где застрял', 'I write a clear status: done, next, blocked'),
    ('frontend', 'comms', 3, 'Сам договариваюсь о решении с дизайном и бэкендом', 'I agree on decisions with design and backend on my own'),
    ('frontend', 'comms', 4, 'Помогаю новичкам и веду обсуждения', 'I help newcomers and lead discussions')
) AS v(track, code, level, ru, en)
JOIN competencies c ON c.track = v.track AND c.code = v.code
ON CONFLICT (competency_id, level) DO NOTHING;

INSERT INTO competency_profiles (user_id, team_id, track) VALUES
    ('a24a3478-cf42-51b1-b05b-9833260247a5', '4496e76d-35da-5cf7-a3d5-c9a89d88c5a2', 'backend'),
    ('2db7cc77-4114-52d8-a833-f670ab60e4e0', 'e5aba0fd-91e6-59e4-a046-7960848af1a2', 'frontend')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO competency_self_assessments (user_id, team_id, competency_id, level)
SELECT 'a24a3478-cf42-51b1-b05b-9833260247a5', '4496e76d-35da-5cf7-a3d5-c9a89d88c5a2', c.id, v.level
FROM (VALUES ('go', 2), ('tests', 1), ('review', 2), ('sql', 2), ('infra', 1), ('comms', 3)) AS v(code, level)
JOIN competencies c ON c.track = 'backend' AND c.code = v.code
ON CONFLICT (user_id, competency_id) DO NOTHING;
