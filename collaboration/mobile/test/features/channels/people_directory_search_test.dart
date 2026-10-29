// Original people-directory search (relayDirectorySearchProvider) over the admitted role
// projection: name match or public-key prefix (hex or npub), nothing else.
import 'package:buzz/features/channels/add_members_sheet.dart';
import 'package:buzz/shared/utils/string_utils.dart';
import 'package:client_kit/shared/contracts/contracts.dart';
import 'package:flutter_test/flutter_test.dart';

RoleMemberView _role(String name, [List<String>? pubkeys]) =>
    RoleMemberView.fromJson({
      'canGrantTenantAdmin': false,
      'canGrantWorkspaceAdmin': false,
      'canRevokeTenantAdmin': false,
      'canRevokeWorkspaceAdmin': false,
      'displayName': name,
      'lastTenantAdmin': false,
      'principalId': 'p-$name',
      'tenantAdmin': false,
      'workspaceAdmin': false,
      'pubkeys': ?pubkeys,
    });

void main() {
  const key =
      '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d';
  test('an empty query lists everyone admitted', () {
    expect(matchesPeopleDirectoryQuery(_role('Dana'), ''), true);
    expect(matchesPeopleDirectoryQuery(_role('Dana'), '  '), true);
  });

  test('a name matches anywhere, case-insensitively', () {
    expect(matchesPeopleDirectoryQuery(_role('Dana Scully'), 'scu'), true);
    expect(matchesPeopleDirectoryQuery(_role('Dana Scully'), 'mulder'), false);
  });

  test('a key matches by hex or npub prefix only', () {
    final role = _role('Dana', [key]);
    expect(matchesPeopleDirectoryQuery(role, '3bf0c6'), true);
    expect(
      matchesPeopleDirectoryQuery(role, fullNpub(key)!.substring(0, 12)),
      true,
    );
    expect(
      matchesPeopleDirectoryQuery(role, 'f0c63f'),
      false,
      reason: 'prefix',
    );
    expect(matchesPeopleDirectoryQuery(_role('Dana'), '3bf0c6'), false);
  });
}
