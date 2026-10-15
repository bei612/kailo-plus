# Release and CI Guide

> Checklist before pushing to `main` and before cutting a release point.
> Details live in the specs linked below.

## Before every push to main
- [ ] `kailo-ci check-step <sha> lint` is SUCCEEDED. Rust: rustfmt + clippy clean
      (dev box has no toolchain — use the check image on the CI node).
- [ ] SQL shape changed → `cargo sqlx prepare --workspace` and `.sqlx` committed
      in the same push (`backend/database-guidelines.md` → Migrations).
- [ ] `contracts/` changed → `kailo-ci gen <sha>` output committed in the same push;
      otherwise lint fails on `gen --check` and verify fails on roundtrip tests.
- [ ] A new contract output field → every SQL guard/CHECK enumerating that JSON
      shape updated (`backend/database-guidelines.md` → Scenario).
- [ ] During a release freeze, do not push to main.

## Pinning a rebuilt artifact
- [ ] Replace the old digest in **all** of: `*/fork/upstream.yaml`
      (source_digest + artifact_digest), `deploy/local/compose.yaml`, and
      `tools/traceability/*.yaml`. Pinning only the source record leaves compose
      and traces on the old image (full check steps 6/9 fail).
- [ ] Any change under an artifact's `inputs` (including tests and client-kit
      i18n) makes that artifact stale; rebuild it before the full check.

## Before deploying from a release tree on the CI node
- [ ] `chmod 644` gateway configs in the tree before recreating gateways.
- [ ] Remove `.env/secrets/data` symlinks the release script created, or
      `kailo-ci deploy` refuses the dirty tree.
- [ ] `git -C /volumes/kailo/apps status deploy/` shows no uncommitted CI-node hotfix.
- [ ] Back up core-db and buzz-db first.

## Images
- [ ] Config files copied into images use `COPY --chmod=0644` and directories are
      pre-created `0755` (`backend/quality-guidelines.md`).
