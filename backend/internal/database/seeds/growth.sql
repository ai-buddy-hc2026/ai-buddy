-- Синтетические данные роста и сообщества для демо. Существующие записи сохраняются.
INSERT INTO community_events (id, team_id, kind, title, description, starts_at, minutes, place_id, place_name, host_id, tags, capacity, materials) VALUES
    ('7c1e0a51-4d2b-5f0e-9a11-000000000001', '4496e76d-35da-5cf7-a3d5-c9a89d88c5a2', 'training', 'Как устроен деплой в команде', 'Разбор пайплайна от MR до прода на живом примере.', '2026-11-18T12:00:00+03:00', 60, 'room-orbit', 'Переговорка Орбита', '4a59a828-3b1a-55e4-bf9b-81db5ad6183a', '{deploy,ci}', 12, '{"Прочитать README сервиса"}'),
    ('7c1e0a51-4d2b-5f0e-9a11-000000000002', '4496e76d-35da-5cf7-a3d5-c9a89d88c5a2', 'user', 'Пробежка после работы', 'Лёгкие 5 км по набережной, темп разговорный.', '2026-11-19T19:00:00+03:00', 60, NULL, 'Вход в офис', '10000000-0000-0000-0000-000000000003', '{бег}', NULL, '{}'),
    ('7c1e0a51-4d2b-5f0e-9a11-000000000003', '4496e76d-35da-5cf7-a3d5-c9a89d88c5a2', 'internal', 'Вечер настолок', 'Берём Codenames и Каркассон, новичкам объясним правила.', '2026-11-20T18:30:00+03:00', 120, 'kitchen-3', 'Кухня 3 этажа', '4a59a828-3b1a-55e4-bf9b-81db5ad6183a', '{настолки}', 8, '{}'),
    ('7c1e0a51-4d2b-5f0e-9a11-000000000004', 'e5aba0fd-91e6-59e4-a046-7960848af1a2', 'avitotech', 'Митап платформенной команды', 'Доклады про observability и SLO.', '2026-11-21T17:00:00+03:00', 90, NULL, 'Онлайн', '0f8153be-1c96-5e0f-aa4c-55b7ed7bf47a', '{observability}', NULL, '{}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO event_attendees (event_id, team_id, user_id) VALUES
    ('7c1e0a51-4d2b-5f0e-9a11-000000000002', '4496e76d-35da-5cf7-a3d5-c9a89d88c5a2', '4a59a828-3b1a-55e4-bf9b-81db5ad6183a')
ON CONFLICT DO NOTHING;

INSERT INTO user_interests (user_id, team_id, tag) VALUES
    ('a24a3478-cf42-51b1-b05b-9833260247a5', '4496e76d-35da-5cf7-a3d5-c9a89d88c5a2', 'бег'),
    ('4a59a828-3b1a-55e4-bf9b-81db5ad6183a', '4496e76d-35da-5cf7-a3d5-c9a89d88c5a2', 'бег'),
    ('4a59a828-3b1a-55e4-bf9b-81db5ad6183a', '4496e76d-35da-5cf7-a3d5-c9a89d88c5a2', 'настолки'),
    ('10000000-0000-0000-0000-000000000003', '4496e76d-35da-5cf7-a3d5-c9a89d88c5a2', 'настолки')
ON CONFLICT DO NOTHING;

INSERT INTO brag_items (id, team_id, user_id, kind, title, link, occurred_on) VALUES
    ('7c1e0a51-4d2b-5f0e-9a11-000000000101', '4496e76d-35da-5cf7-a3d5-c9a89d88c5a2', 'a24a3478-cf42-51b1-b05b-9833260247a5', 'review', 'Илья: «быстро разобралась со структурой сервиса»', NULL, '2026-11-06'),
    ('7c1e0a51-4d2b-5f0e-9a11-000000000102', '4496e76d-35da-5cf7-a3d5-c9a89d88c5a2', 'a24a3478-cf42-51b1-b05b-9833260247a5', 'pr', 'MR !412: поправила опечатки в README сервиса', 'https://gitlab.test/ads/-/merge_requests/412', '2026-11-10')
ON CONFLICT (id) DO NOTHING;

INSERT INTO feedback_requests (id, team_id, requester_id, recipient_id, artifact_url, artifact_title, question, answer, sent_at, expires_at, answered_at) VALUES
    ('7c1e0a51-4d2b-5f0e-9a11-000000000201', '4496e76d-35da-5cf7-a3d5-c9a89d88c5a2', 'a24a3478-cf42-51b1-b05b-9833260247a5', '4a59a828-3b1a-55e4-bf9b-81db5ad6183a', 'https://gitlab.test/ads/-/merge_requests/412', 'MR !412', 'Понятно ли описание MR?', 'Да, коротко и по делу. Добавь ссылку на задачу', '2026-11-10T10:00:00+03:00', '2026-11-17T10:00:00+03:00', '2026-11-10T15:00:00+03:00')
ON CONFLICT (id) DO NOTHING;
