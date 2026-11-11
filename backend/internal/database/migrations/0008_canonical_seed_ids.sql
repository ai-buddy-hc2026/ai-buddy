-- Приводит ID синтетических команд и пользователей к значениям из checklist seed.
-- Временное каскадное обновление внешних ключей сохраняет все связи существующей БД.
CREATE TEMP TABLE _seed_fk_constraints ON COMMIT DROP AS
SELECT conrelid, conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE contype = 'f' AND connamespace = 'public'::regnamespace;

DO $$
DECLARE
    fk record;
    cascade_definition text;
BEGIN
    FOR fk IN SELECT conrelid, conname FROM _seed_fk_constraints LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk.conrelid::regclass, fk.conname);
    END LOOP;

    FOR fk IN SELECT conrelid, conname, definition FROM _seed_fk_constraints LOOP
        cascade_definition := replace(fk.definition, ' ON DELETE ', ' ON UPDATE CASCADE ON DELETE ');
        IF cascade_definition = fk.definition THEN
            cascade_definition := fk.definition || ' ON UPDATE CASCADE';
        END IF;
        EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', fk.conrelid::regclass, fk.conname, cascade_definition);
    END LOOP;
END $$;

-- Каскад обновляет team_id уже завершенных действий; этот триггер защищает
-- пользовательские изменения действия и должен быть выключен только на время миграции.
ALTER TABLE actions_log DISABLE TRIGGER actions_protect_confirmed;

UPDATE teams SET id = '4496e76d-35da-5cf7-a3d5-c9a89d88c5a2'
WHERE id = '00000000-0000-0000-0000-000000000001';
UPDATE teams SET id = 'e5aba0fd-91e6-59e4-a046-7960848af1a2'
WHERE id = '00000000-0000-0000-0000-000000000002';

UPDATE users SET id = 'a24a3478-cf42-51b1-b05b-9833260247a5'
WHERE id = '10000000-0000-0000-0000-000000000001';
UPDATE users SET id = '4a59a828-3b1a-55e4-bf9b-81db5ad6183a'
WHERE id = '10000000-0000-0000-0000-000000000002';
UPDATE users SET id = '2db7cc77-4114-52d8-a833-f670ab60e4e0'
WHERE id = '10000000-0000-0000-0000-000000000004';
UPDATE users SET id = '0f8153be-1c96-5e0f-aa4c-55b7ed7bf47a'
WHERE id = '10000000-0000-0000-0000-000000000005';

ALTER TABLE actions_log ENABLE TRIGGER actions_protect_confirmed;

DO $$
DECLARE
    fk record;
BEGIN
    FOR fk IN SELECT conrelid, conname, definition FROM _seed_fk_constraints LOOP
        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk.conrelid::regclass, fk.conname);
        EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', fk.conrelid::regclass, fk.conname, fk.definition);
    END LOOP;
END $$;
