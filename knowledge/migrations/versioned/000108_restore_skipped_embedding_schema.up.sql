-- Migration 000108 (Kailo): restore the postgres retrieval schema that earlier
-- migrations skipped (DD-128(5), SF-WEK-18).
--
-- A database first migrated while RETRIEVE_DRIVER excluded postgres ran its
-- embedding migrations with app.skip_embedding=true: 000002 created no
-- embeddings table, BM25 or HNSW index, 000008/000011/000099 did not update
-- pg_search, and 000007/000059 found no table. golang-migrate recorded them as
-- applied, so declaring RETRIEVE_DRIVER=postgres later never re-runs them and
-- hybrid search keeps returning nothing.
--
-- This migration replays exactly the skipped DDL, in the original order, once
-- the driver is declared:
--   * app.skip_embedding=true  -> no-op (the deployment still has no postgres
--     retrieval; the schema stays absent, as 000002 leaves it);
--   * embeddings present       -> no-op for the table and every index (all
--     IF NOT EXISTS / existence checked, same names and definitions), and no
--     extension update: a database that never skipped already ran them;
--   * embeddings absent        -> create everything 000002/000007/000059 would
--     have created and apply the pg_search updates of 000008/000011/000099, so
--     the result equals a normally initialised database.
-- 000008's tag backfill and 000002's REINDEX touch only existing rows; the
-- restored table is empty, so they have nothing to do.

DO $$
DECLARE
    restoring BOOLEAN;
    installed_version TEXT;
BEGIN
    IF current_setting('app.skip_embedding', true) = 'true' THEN
        RAISE NOTICE '[Migration 000108] app.skip_embedding=true · retrieval schema stays absent';
        RETURN;
    END IF;

    restoring := NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'embeddings');
    IF NOT restoring THEN
        RAISE NOTICE '[Migration 000108] embeddings present · checking indexes only';
    ELSE
        RAISE NOTICE '[Migration 000108] embeddings absent · restoring the skipped retrieval schema';
    END IF;

    -- 000002: extensions, table, unique/BM25/HNSW indexes, enhancements.
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    CREATE EXTENSION IF NOT EXISTS pg_search;

    CREATE TABLE IF NOT EXISTS embeddings (
        id SERIAL PRIMARY KEY,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

        source_id VARCHAR(64) NOT NULL,
        source_type INTEGER NOT NULL,
        chunk_id VARCHAR(64),
        knowledge_id VARCHAR(64),
        knowledge_base_id VARCHAR(64),
        content TEXT,
        dimension INTEGER NOT NULL,
        embedding halfvec
    );

    CREATE UNIQUE INDEX IF NOT EXISTS embeddings_unique_source ON embeddings(source_id, source_type);

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'embeddings_search_idx') THEN
        CREATE INDEX embeddings_search_idx ON embeddings
        USING bm25 (id, knowledge_base_id, content, knowledge_id, chunk_id)
        WITH (
            key_field = 'id',
            text_fields = '{
                "content": {
                  "tokenizer": {"type": "chinese_lindera"}
                }
            }'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'embeddings_embedding_idx' OR indexname LIKE 'embeddings_embedding%3584%') THEN
        CREATE INDEX embeddings_embedding_idx_3584 ON embeddings
        USING hnsw ((embedding::halfvec(3584)) halfvec_cosine_ops)
        WITH (m = 16, ef_construction = 64)
        WHERE (dimension = 3584);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'embeddings_embedding_idx_798' OR indexname LIKE 'embeddings_embedding%798%') THEN
        CREATE INDEX embeddings_embedding_idx_798 ON embeddings
        USING hnsw ((embedding::halfvec(798)) halfvec_cosine_ops)
        WITH (m = 16, ef_construction = 64)
        WHERE (dimension = 798);
    END IF;

    ALTER TABLE embeddings ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN DEFAULT TRUE;
    CREATE INDEX IF NOT EXISTS idx_embeddings_is_enabled ON embeddings(is_enabled);
    CREATE INDEX IF NOT EXISTS idx_embeddings_knowledge_base_id ON embeddings(knowledge_base_id);

    -- 000007: FAQ priority tag column.
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'embeddings' AND column_name = 'tag_id'
    ) THEN
        ALTER TABLE embeddings ADD COLUMN tag_id VARCHAR(36);
    END IF;
    CREATE INDEX IF NOT EXISTS idx_embeddings_tag_id ON embeddings(tag_id);

    -- 000008 and 000011: pg_search update, only where it was skipped.
    IF restoring THEN
        ALTER EXTENSION pg_search UPDATE;
    END IF;

    -- 000059: 1024-dimension HNSW index.
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'embeddings_embedding_idx_1024' OR indexname LIKE 'embeddings_embedding%1024%') THEN
        CREATE INDEX embeddings_embedding_idx_1024 ON embeddings
        USING hnsw ((embedding::halfvec(1024)) halfvec_cosine_ops)
        WITH (m = 16, ef_construction = 64)
        WHERE (dimension = 1024);
    END IF;

    -- 000095: the memory vector column it adds once pgvector exists.
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'memory_item_embeddings') THEN
        ALTER TABLE memory_item_embeddings ADD COLUMN IF NOT EXISTS embedding halfvec;
    END IF;

    -- 000099: same pg_search 0.22.6 rule, only where it was skipped.
    IF restoring THEN
        SELECT extversion INTO installed_version FROM pg_extension WHERE extname = 'pg_search';
        IF installed_version IN ('0.22.2', '0.22.3', '0.22.4', '0.22.5') AND EXISTS (
            SELECT 1 FROM pg_available_extension_versions
            WHERE name = 'pg_search' AND version = '0.22.6'
        ) THEN
            ALTER EXTENSION pg_search UPDATE TO '0.22.6';
        END IF;
    END IF;

    RAISE NOTICE '[Migration 000108] retrieval schema ready';
END $$;
