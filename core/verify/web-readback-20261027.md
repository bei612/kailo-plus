# Online Web readback, 2026-10-27

This is a bounded readback of the running deployment, not acceptance of the
candidate source or a complete user journey. The implementation candidate was
`5a1184525d7941067d81384f504d9fd431fe39c3`; it was not deployed in this run.
The running `platform-local-buzz-web-1` container reported image ID
`sha256:86effa5e9adb4b720712e075bafd8df0769d4789b2fabdcb0d225eac929f918f`,
started `2026-10-24T05:37:03.6615636Z`. Its own build-info reported build ID
`sha256:3ce317f3eead204dd87530431979bdb81362c9a7037cdddc05dbfacb690288d5`.
This is a container readback; no independent browser build-info comparison was
made and the image ID is not a registry release digest.

From the CI node, the original `playwright-cli` used an isolated Chrome session
against the existing gateway. A normal OIDC login with the already-provisioned
verification account reached the existing channel. The helper reported
`ReferenceError: URL is not defined` after submitting the login; the following
actual browser snapshot established the application page. No credential was
printed or copied into this record. The browser session was closed afterwards.

The following screens were opened and their viewport screenshots inspected:

- SSO login, an existing channel and Inbox with an existing direct conversation.
- Wren modeling view showing six existing models.
- Knowledge library view showing an existing library.
- Cells home and its existing Personal Files listing.

These initial observations prove the listed rendered states and read navigation
only. During that initial pass no message, draft, upload, download, document edit,
knowledge import, model query, multi-user interaction or revocation was executed.
The later single query below is separately recorded. Existing component entry
visibility does not establish current candidate binding or release conformance.
The browser reported an avatar HTTP 404, blocked cross-origin autofocusing,
`Failed Loading UploaderModel` / `Failed to fetch`, and `Cannot find user` while
visiting the pages. These remain actual observed errors; this run did not locate
their cause or prove an upload attempt.

Screenshots remain on the CI Data volume at
`/volumes/data/kailo/verification/browser-readback-20261027/`; they include
existing application data and are not copied into the repository. SHA-256:

| Screenshot | SHA-256 |
| --- | --- |
| login.png | `fdc60a9c72206d1ba203e17f2fc08f3ddc5452cedbcc276435197f6216ab490f` |
| channel.png | `6099797317e8bb171166744a58f4939642fdecd14b8670e24c2f009a9ddce2e6` |
| inbox.png | `cf816ea77263516664a7d6d9ab44d7d2d45465ec0eaea3af0172b0f6cd658a72` |
| wren.png | `40e35de8c836bc6217618afd69a946e410bd32217f33177323096a8e0d74d953` |
| knowledge.png | `4e80b4b3073edabf3373bd7813723173ecbbe5c784cffbe75c1f213376e1d666` |
| cells.png | `1181094ba191469df27fe7071c2d3053800668fb407b414c9f1baaf6d78ad748` |
| cells-files.png | `6cb8c956e80a31943ac575d0de22618443d884a95e06e6c33fe36b8c913e708d` |

No deployment, artifact update or full check was performed. The browser-only
readback cannot establish source parity, device acceptance, visual-system parity,
or production readiness.

## Subsequent single Wren query

Using a fresh isolated browser and the existing verification account, the same
running deployment received the single question `订单总数是多少？`. The original
question page showed its preparation steps, model candidates and SQL generation,
then displayed an answer of **36,000** and a `total_orders` result row of
**36000**. The original SQL tab displayed
`SELECT COUNT("order_id") AS "total_orders" FROM "public_orders"`. This is the
result shown by the deployed application, not an independent database count or
proof of every policy, quota, audit or model-provider boundary. The operation
created a question/history item; the operator did not delete it or submit another.

Refreshing the host page returned to the modeling view rather than the question.
After manually opening the original question tab and the same history item, the
answer, result row and SQL tab were visible again. That proves this observed
readback; it does not prove automatic restoration of the embedded route or the
absence of any server-side repeated work. No new candidate was built or deployed.
The browser was closed. The same private Data evidence directory contains the
screenshots and snapshots below, which were opened and inspected where applicable:

| Evidence | SHA-256 |
| --- | --- |
| wren-query.png | `33467da28427be04d241188ebaf10142008537765a28de850f83bb0401340d52` |
| wren-reload.png | `40e35de8c836bc6217618afd69a946e410bd32217f33177323096a8e0d74d953` |
| wren-reopened.png | `e8eb50d017677d16719e74072639e17e55550510ef7248c6be162ebfb566f964` |
| wren-sql.png | `9ca695dfdf1d1cf4ac35ff6f59a3b6157768a9ab84fff231e997838b54223a19` |
| wren-query-final.txt | `35aad36fd786ce801bf8366388104435dd6c1232ef45611e27411031480ae473` |
| wren-query-terminal.txt | `6df295c8d0ebae1c13c66fa9bc547ec458670641fbaf0408dfd6046d9a8a6332` |
