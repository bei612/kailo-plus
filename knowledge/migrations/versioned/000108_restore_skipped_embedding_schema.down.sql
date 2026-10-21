-- Migration 000108 Down (Kailo): no-op.
-- The up migration only restores schema that 000002/000007/000059 own and
-- replays the pg_search updates of 000008/000011/000099. A restored database
-- cannot be told apart from a normally initialised one, so dropping the
-- embeddings table here would destroy retrieval data that belongs to those
-- migrations (their own down files remove it), and ALTER EXTENSION UPDATE
-- has no reverse operation (see 000011 down).
SELECT 1;
