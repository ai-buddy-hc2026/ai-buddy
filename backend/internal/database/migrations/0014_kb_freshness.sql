-- Свежесть источников (идея 32): когда документ проверяли и кто за него отвечает.
ALTER TABLE kb_documents
    ADD COLUMN reviewed_at date,
    ADD COLUMN owner text CHECK (owner IS NULL OR (btrim(owner) <> '' AND char_length(owner) <= 200));
