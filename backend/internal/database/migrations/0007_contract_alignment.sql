CREATE TABLE absence_policies (
 team_id uuid PRIMARY KEY REFERENCES teams(id) ON DELETE RESTRICT,
 notice_period_days integer NOT NULL CHECK (notice_period_days>=0),
 allowed_types jsonb NOT NULL CHECK (jsonb_typeof(allowed_types)='array' AND jsonb_array_length(allowed_types)>0)
);
-- Синтетическая конфигурация профиля 1.1, не кадровый регламент.
INSERT INTO absence_policies(team_id,notice_period_days,allowed_types)
SELECT id,3,'[{"code":"day_off","label":"Отгул"}]'::jsonb FROM teams;

ALTER TABLE absence_requests DROP CONSTRAINT absence_requests_absence_type_check;
UPDATE absence_requests SET absence_type=CASE absence_type WHEN 'отгул' THEN 'day_off' WHEN 'отпуск' THEN 'vacation' ELSE absence_type END;
ALTER TABLE absence_requests ADD CONSTRAINT absence_requests_absence_type_check CHECK (absence_type ~ '^[a-z][a-z0-9_]{0,63}$');

-- Однократное преобразование старых снимков в эквивалентные коды профиля 1.1.
-- UUID, ключ, автор, состояние и число попыток сохраняются.
ALTER TABLE actions_log DISABLE TRIGGER actions_protect_confirmed;
UPDATE actions_log SET parameters=jsonb_set(parameters,'{type}',to_jsonb(CASE parameters->>'type' WHEN 'отгул' THEN 'day_off' ELSE 'vacation' END))
WHERE action_type='absences.create_request' AND parameters->>'type' IN ('отгул','отпуск');
UPDATE actions_log SET result=jsonb_build_object('action_id',id,'external_id',result->>'id','status',result->>'status','approver',result->>'approver')
WHERE action_type='absences.create_request' AND status='succeeded' AND result ? 'id';
UPDATE actions_log a SET result=jsonb_build_object('task_id',a.result->>'id','old_status',COALESCE((SELECT h.from_status FROM task_status_history h WHERE h.task_id=(a.result->>'id')::uuid AND h.version=(a.result->>'version')::integer),a.result->>'status'),
 'status',a.result->>'status','version',(a.result->>'version')::integer,'updated_at',to_char((a.result->>'updated_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
WHERE a.action_type='checklist.update_status' AND a.status='succeeded' AND a.result ? 'id';
ALTER TABLE actions_log ENABLE TRIGGER actions_protect_confirmed;
