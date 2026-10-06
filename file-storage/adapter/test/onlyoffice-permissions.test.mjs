import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

// Execute the two existing native permission objects themselves. This is a
// mapping check, not a claim that DocumentServer authRestore or WOPI ran live.
const page = await readFile(new URL('../../../document-editor/web-apps/apps/api/wopi/editor-wopi.ejs', import.meta.url), 'utf8');
const server = await readFile(new URL('../../../document-editor/server/DocService/sources/DocsCoServer.js', import.meta.url), 'utf8');
const objects = [
  ['official WOPI page', page.match(/"permissions":\s*(\{[^{}]+\})/)?.[1]],
  ['native WOPI JWT restore', server.slice(server.indexOf('function fillDataFromWopiJwt(')).match(/const permissions =\s*(\{[^{}]+\})/)?.[1]],
];

test('both native ONLYOFFICE permission mirrors keep export decisions after token restore', async (t) => {
  for (const [name, object] of objects) {
    assert.ok(object, `${name}: existing permission object must remain located`);
    await t.test(name, () => {
      const permissions = (fileInfo) => runInNewContext(`(${object})`, { fileInfo, queryParams: { dchat: '1' },
        permissionsEdit: true, permissionsReview: undefined, permissionsComment: true, permissionsFillForm: true });
      assert.equal(permissions({}).copy, true);
      assert.equal(permissions({}).download, true);
      assert.equal(permissions({ DisableCopy: true }).copy, false);
      assert.equal(permissions({ CopyPasteRestrictions: 'CurrentDocumentOnly' }).copy, false);
      assert.equal(permissions({ CopyPasteRestrictions: 'BlockAll' }).copy, false);
      assert.equal(permissions({ DisableExport: true }).download, false);
      assert.equal(permissions({ HideExportOption: true }).download, false);
      assert.equal(permissions({ DisablePrint: true }).print, false);
      assert.equal(permissions({ HidePrintOption: true }).print, false);
      assert.equal(permissions({}).chat, false);
    });
  }
});
