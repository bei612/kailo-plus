# Database Guidelines

> Database patterns and conventions for this project.

---

## Overview

<!--
Document your project's database conventions here.

Questions to answer:
- What ORM/query library do you use?
- How are migrations managed?
- What are the naming conventions for tables/columns?
- How do you handle transactions?
-->

(To be filled by the team)

---

## Query Patterns

<!-- How should queries be written? Batch operations? -->

(To be filled by the team)

---

## Migrations

- Migrations live in `core/migrations/<YYYYMMDDHHMMSS>_<name>.{up,down}.sql`; every up has a paired down.
  `tools/check.sh` step 4 runs forward → back → forward on a throwaway Postgres.
- An applied migration is immutable (sqlx checksum), comments included — see
  `quality-guidelines.md`. Fix a shipped guard/constraint with a **new** migration that
  `CREATE OR REPLACE`s it; the down restores the previous definition verbatim.
- SQL-only migrations can be applied on the CI node without rebuilding Core
  (Core does not embed migrations): `tools/release/kailo-release.sh run` (ADR-20) detects
  pending versions against `_sqlx_migrations`, backs up `core-db` in its backup stage, then
  runs `sqlx migrate run` from the fixed release tree before replacing any service.
- Queries that change shape need `cargo sqlx prepare --workspace` in `core/` and the
  `.sqlx` files committed in the same push, or verify fails with
  "sqlx 离线数据过期".

---

## Naming Conventions

<!-- Table names, column names, index names -->

(To be filled by the team)

---

## Common Mistakes

## Scenario: Guards and CHECK constraints over JSON contract fields

### 1. Scope / Trigger
- Any migration that validates a `jsonb` column whose shape is defined by
  `contracts/` (step traces, dispatch intents, webhook outcomes, usage evidence).
- Two production failures on 2026-10-15 came from exactly this:
  `guard_automation_webhook()` (20261015020000, fixed by 20261015050000) and
  `projection.valid_automation_step_trace` (20261010010000, fixed by 20261015060000).

### 2. Signatures
- `CREATE OR REPLACE FUNCTION <schema>.<guard>() RETURNS trigger LANGUAGE plpgsql`
- `CHECK (<schema>.valid_<thing>(column))` on the owning table.

### 3. Contracts
- The allowed key set in SQL must equal the contract schema's properties
  (e.g. `AutomationStepTraceOutput` has `requestId:string`, `httpStatus:integer`).
- When a contract adds a field, the same change set adds it to every SQL guard
  and CHECK that enumerates keys.

### 4. Validation & Error Matrix
- Key missing from the SQL allow-list → `23514 <table>_<column>_check` on every
  write; Worker/Activity retries forever (before 879e1dcc) and holds DB connections.
- Operator precedence bug → `22P02 invalid input syntax for type json` on the guarded
  transition; the row never advances (call_webhook stayed CREATED).

### 5. Good/Base/Bad Cases
- Good: `((NEW.intent->'usage') - ARRAY['a','b']) = '{}'::jsonb`
- Base: `(NEW.intent - ARRAY['usage','digest']) = '{}'::jsonb` (operator on a column).
- Bad: `NEW.intent->'usage' - ARRAY[...]` — parsed as `NEW.intent -> ('usage' - ARRAY[...])`.

### 6. Tests Required
- A real-Postgres test (see `call_webhook::guard_tests`,
  `run_trace` webhook evidence test) that: a valid contract-shaped value passes the
  guard/CHECK; an extra key, a wrong type and an empty required string are refused.
- Build the fixture through the generated contract type, not a hand-written JSON
  literal, so the test fails when the contract grows.

### 7. Wrong vs Correct
#### Wrong
```sql
AND (NEW.webhook_intent->'usage'-ARRAY['created_at','meter'])='{}'::jsonb
```
#### Correct
```sql
AND ((NEW.webhook_intent->'usage')-ARRAY['created_at','meter'])='{}'::jsonb
```
`-`, `+`, `||` bind tighter than `->`/`->>` in PostgreSQL; always parenthesize the
extraction before applying another operator.
