#!/usr/bin/env bash
# DD-151: run ONLY in an isolated fixed-source SDK export, after the positive push tests.
# Mutates one production transition temporarily; never run against a development worktree.
set -euo pipefail
: "${PUSH_TEST_DATABASE_URL:?isolated migrated database required}"
[[ -f /.dockerenv && ! -e .git ]] || { echo 'requires an isolated Docker source export'; exit 2; }
source_file=core/crates/platform-core/src/push/intent.rs
backup=$(mktemp)
negative=$(mktemp)
scan_file=core/crates/platform-core/src/push/scan.rs
scan_backup=$(mktemp)
cp "$scan_file" "$scan_backup"
cp "$source_file" "$backup"
restore() { cp "$backup" "$source_file"; cp "$scan_backup" "$scan_file"; rm -f "$backup" "$negative" "$scan_backup"; }
trap restore EXIT
sha256sum "$source_file"
python3 - "$source_file" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text()
old="when state='SENDING' then 'UNKNOWN' else 'PREPARED'"
assert s.count(old)==1
p.write_text(s.replace(old,"when state='SENDING' then 'PREPARED' else 'PREPARED'"))
PY
set +e
cargo test --locked --manifest-path core/Cargo.toml -p platform-core crashed_send_is_unknown_not_reclaimed -- --include-ignored >"$negative" 2>&1
rc=$?
set -e
cat "$negative"
[[ $rc == 101 ]] || { echo 'negative check did not fail as required'; exit 1; }
python3 - "$negative" <<'PY'
from pathlib import Path
import sys
s=Path(sys.argv[1]).read_text()
assert 'crashed_send_is_unknown_not_reclaimed_and_late_receipt_is_atomic ... FAILED' in s
assert 'left: "PREPARED"' in s and 'right: "UNKNOWN"' in s
PY
cp "$backup" "$source_file"
cmp "$backup" "$source_file"
sha256sum "$source_file"
cargo test --locked --manifest-path core/Cargo.toml -p platform-core crashed_send_is_unknown_not_reclaimed -- --include-ignored
# Remove the actual channel receipt guard and discard all but one page in the consumer.
python3 - "$source_file" "$scan_file" <<'PYNEG'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text();guard=' && lock_channel(&mut tx, i).await?'
assert s.count(guard)==1
p.write_text(s.replace(guard,''))
p=Path(sys.argv[2]);s=p.read_text();loop='for value in values {'
assert s.count(loop)==1
p.write_text(s.replace(loop,'for value in values.into_iter().take(page_size) {'))
PYNEG
set +e
cargo test --locked --manifest-path core/Cargo.toml -p platform-core push::intent::tests:: -- --include-ignored >"$negative" 2>&1
rc=$?
set -e
cat "$negative"
[[ $rc == 101 ]] || { echo 'channel/page negative check did not fail'; exit 1; }
python3 - "$negative" <<'PYNEG'
from pathlib import Path
import sys
s=Path(sys.argv[1]).read_text()
assert 'channel_revoked_while_provider_inflight_cannot_restore_badge_or_query ... FAILED' in s
assert 'authenticated_same_second_multi_page_scan_commits_every_event_once ... FAILED' in s
assert 'left: (500, 500)' in s and 'right: (1001, 1001)' in s
PYNEG
cp "$backup" "$source_file"
cp "$scan_backup" "$scan_file"
cmp "$backup" "$source_file"
cmp "$scan_backup" "$scan_file"
sha256sum "$source_file" "$scan_file"
cargo test --locked --manifest-path core/Cargo.toml -p platform-core push::intent::tests:: -- --include-ignored
# Live external-effect references must also prevent destructive schema rollback.
set +e
sqlx migrate revert --source core/migrations >"$negative" 2>&1
rc=$?
set -e
cat "$negative"
[[ $rc != 0 ]] || { echo 'populated intent rollback unexpectedly succeeded'; exit 1; }
python3 - "$negative" <<'PY'
from pathlib import Path
import sys
assert 'push intents must be reconciled before rollback' in Path(sys.argv[1]).read_text()
PY
printf 'negative UNKNOWN transition failed as expected; exact source restored and passed; live rollback refused\n'
