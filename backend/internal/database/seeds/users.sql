-- Синтетические данные из docs/users.md. Существующие записи сохраняются.
INSERT INTO teams (id, code, name, timezone) VALUES
    ('4496e76d-35da-5cf7-a3d5-c9a89d88c5a2', 'team_avito_ai', 'Team 1', 'Europe/Moscow'),
    ('e5aba0fd-91e6-59e4-a046-7960848af1a2', 'team_avito_platform', 'Team 2', 'Europe/Moscow')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, team_id, login, display_name, role, buddy_id, manager_id, timezone, active, updated_at) VALUES
    ('a24a3478-cf42-51b1-b05b-9833260247a5', '4496e76d-35da-5cf7-a3d5-c9a89d88c5a2', 'intern_anya', 'Anya', 'intern', '4a59a828-3b1a-55e4-bf9b-81db5ad6183a', '10000000-0000-0000-0000-000000000003', NULL, true, '2026-11-10T00:00:00Z'),
    ('4a59a828-3b1a-55e4-bf9b-81db5ad6183a', '4496e76d-35da-5cf7-a3d5-c9a89d88c5a2', 'buddy_ilya', 'Ilya', 'buddy', NULL, '10000000-0000-0000-0000-000000000003', NULL, true, '2026-11-10T00:00:00Z'),
    ('10000000-0000-0000-0000-000000000003', '4496e76d-35da-5cf7-a3d5-c9a89d88c5a2', 'lead_maria', 'Maria', 'lead', NULL, NULL, NULL, true, '2026-11-10T00:00:00Z'),
    ('2db7cc77-4114-52d8-a833-f670ab60e4e0', 'e5aba0fd-91e6-59e4-a046-7960848af1a2', 'intern_petr', 'Petr', 'intern', '0f8153be-1c96-5e0f-aa4c-55b7ed7bf47a', '10000000-0000-0000-0000-000000000006', NULL, true, '2026-11-10T00:00:00Z'),
    ('0f8153be-1c96-5e0f-aa4c-55b7ed7bf47a', 'e5aba0fd-91e6-59e4-a046-7960848af1a2', 'buddy_olga', 'Olga', 'buddy', NULL, '10000000-0000-0000-0000-000000000006', NULL, true, '2026-11-10T00:00:00Z'),
    ('10000000-0000-0000-0000-000000000006', 'e5aba0fd-91e6-59e4-a046-7960848af1a2', 'lead_alexey', 'Alexey', 'lead', NULL, NULL, NULL, true, '2026-11-10T00:00:00Z')
ON CONFLICT (id) DO NOTHING;
