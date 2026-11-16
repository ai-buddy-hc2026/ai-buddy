ALTER TABLE chat_messages
    ADD COLUMN answer_status text CHECK (answer_status IS NULL OR answer_status IN ('answered', 'unknown')),
    ADD COLUMN question_category text CHECK (question_category IS NULL OR question_category IN ('task', 'process', 'access', 'technical', 'other')),
    ADD CONSTRAINT chat_messages_metadata_role CHECK (
        role = 'assistant' OR (answer_status IS NULL AND question_category IS NULL)
    );
