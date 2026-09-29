import { expect, type Page, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// Kailo platform pages on Desktop: the same components Buzz Web renders
// (Kailo shared package), reached from the sidebar, with every request going
// through the Rust-side `kailo_api` command.

const DEVICE_PUBKEY = "deadbeef".repeat(8);
const OTHER_DEVICE = "0123abcd".repeat(8);

async function kailoPaths(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (
      (
        window as Window & {
          __BUZZ_E2E_COMMAND_PAYLOADS__?: Array<{
            command: string;
            payload: unknown;
          }>;
        }
      ).__BUZZ_E2E_COMMAND_PAYLOADS__ ?? []
    )
      .filter((entry) => entry.command === "kailo_api")
      .map((entry) => {
        const { method, path } = entry.payload as {
          method: string;
          path: string;
        };
        return `${method} ${path}`;
      }),
  );
}

test("members, own audit and own devices are in the navigation and load through kailo_api", async ({
  page,
}) => {
  await installMockBridge(page, {
    kailo: {
      workspaces: [{ id: "ws-1", name: "Operations", slug: "ops" }],
      members: [
        {
          principalId: "p-1",
          displayName: "Ada Lovelace",
          state: "ACTIVE",
          pubkeys: [DEVICE_PUBKEY, OTHER_DEVICE],
        },
      ],
      audit: [
        {
          actionKey: "identity.client-key.register",
          decision: "ALLOW",
          eventType: "DECISION",
          occurredAt: new Date().toISOString(),
          resultCode: "ACCEPTED",
        },
      ],
    },
  });
  await page.goto("/");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();

  await page.getByTestId("sidebar-platform-members").click();
  const members = page.getByTestId("platform-members");
  await expect(
    members.getByRole("row", { name: /Ada Lovelace/ }),
  ).toBeVisible();
  await expect(members).toContainText("deadbeef…beef · 0123abcd…abcd");

  await page.getByTestId("sidebar-platform-audit").click();
  await expect(
    page.getByTestId("platform-audit").getByRole("row", {
      name: /identity\.client-key\.register/,
    }),
  ).toBeVisible();

  await page.getByTestId("sidebar-platform-devices").click();
  await expect(page.getByTestId("platform-devices")).toContainText(
    "This device",
  );

  expect(await kailoPaths(page)).toEqual(
    expect.arrayContaining([
      "GET /api/v1/workspaces",
      "GET /api/v1/workspaces/ws-1/members",
      "GET /api/v1/audit",
      "GET /api/v1/identity/client-keys",
    ]),
  );
});

test("revoking another device goes through the BFF and the list is re-read", async ({
  page,
}) => {
  await installMockBridge(page, {
    kailo: {
      otherDevices: [
        {
          pubkey: OTHER_DEVICE,
          state: "ACTIVE",
          createdAt: new Date().toISOString(),
        },
      ],
    },
  });
  await page.goto("/#/platform/devices");

  const devices = page.getByTestId("platform-devices");
  const other = devices.getByRole("row", { name: /0123abcd/ });
  await other.getByRole("button", { name: "Revoke" }).click();

  await expect(other).toHaveCount(0);
  await expect(devices.getByRole("row", { name: /This device/ })).toBeVisible();
  expect(await kailoPaths(page)).toContain(
    `DELETE /api/v1/identity/client-keys/${OTHER_DEVICE}`,
  );
});

test("a revocation without a definite answer is shown as unknown", async ({
  page,
}) => {
  await installMockBridge(page, {
    kailo: {
      otherDevices: [
        {
          pubkey: OTHER_DEVICE,
          state: "ACTIVE",
          createdAt: new Date().toISOString(),
        },
      ],
      revoke: {
        status: 503,
        body: {
          class: "UNKNOWN",
          reason: "DEPENDENCY_UNAVAILABLE",
          operationId: "op-42",
        },
      },
    },
  });
  await page.goto("/#/platform/devices");

  await page
    .getByTestId("platform-devices")
    .getByRole("row", { name: /0123abcd/ })
    .getByRole("button", { name: "Revoke" })
    .click();
  const alert = page.getByTestId("platform-devices").getByRole("alert");
  await expect(alert).toContainText("unknown");
  await expect(alert).toContainText("op-42");
  await expect(alert).not.toContainText("rejected");
});

test("sign out revokes the session through kailo_sign_out and returns to sign-in", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();

  await page.getByTestId("sidebar-profile-avatar-button").click();
  await page.getByTestId("profile-popover-sign-out").click();

  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
  const commands = await page.evaluate(() =>
    (
      (
        window as Window & {
          __BUZZ_E2E_COMMAND_PAYLOADS__?: Array<{ command: string }>;
        }
      ).__BUZZ_E2E_COMMAND_PAYLOADS__ ?? []
    ).map((entry) => entry.command),
  );
  expect(commands).toContain("kailo_sign_out");
});

const APPROVAL_WF = "kailo:APPROVAL:t-1:ae-1:1";
const APPROVAL_PATH = `/api/v1/approvals/${encodeURIComponent(APPROVAL_WF)}`;

const waitingTask = {
  operationId: "op-task-1",
  actionExecutionId: "ae-1",
  actionKey: "tenant.member.revoke",
  actionVersion: 1,
  targetId: "target-1",
  gateState: "WAITING",
  dispatchState: "NOT_DISPATCHED",
  reason: "WAITING_APPROVAL",
  approvalWorkflowId: APPROVAL_WF,
  approvalStatus: "WAITING",
  createdAt: new Date().toISOString(),
};

const waitingApproval = {
  workflowId: APPROVAL_WF,
  actionExecutionId: "ae-1",
  actionKey: "tenant.member.revoke",
  targetType: "tenant_membership",
  targetId: "target-1",
  initiatorPrincipalId: "principal-other",
  status: "WAITING",
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  decisions: [],
  roleRequirements: [{ selector: "TENANT_ADMIN", minDistinct: 1 }],
};

async function kailoCalls(page: Page) {
  return page.evaluate(() =>
    (
      (
        window as Window & {
          __BUZZ_E2E_COMMAND_PAYLOADS__?: Array<{
            command: string;
            payload: unknown;
          }>;
        }
      ).__BUZZ_E2E_COMMAND_PAYLOADS__ ?? []
    )
      .filter((entry) => entry.command === "kailo_api")
      .map(
        (entry) =>
          entry.payload as { method: string; path: string; body: unknown },
      ),
  );
}

test("my tasks: list, detail with the approval, and withdrawing through the BFF", async ({
  page,
}) => {
  await installMockBridge(page, {
    kailo: {
      routes: {
        "GET /api/v1/tasks": [{ status: 200, body: [waitingTask] }],
        "GET /api/v1/tasks/ae-1": [
          { status: 200, body: waitingTask },
          {
            status: 200,
            body: {
              ...waitingTask,
              gateState: "REVOKED",
              reason: "APPROVAL_WITHDRAWN",
              approvalStatus: "CANCELLED",
            },
          },
        ],
        [`GET ${APPROVAL_PATH}`]: [
          { status: 200, body: waitingApproval },
          { status: 200, body: { ...waitingApproval, status: "CANCELLED" } },
        ],
        [`POST ${APPROVAL_PATH}/withdraw`]: [
          { status: 200, body: { status: "CANCELLED" } },
        ],
      },
    },
  });
  await page.goto("/");
  await page.getByTestId("sidebar-platform-tasks").click();

  const tasks = page.getByTestId("platform-tasks");
  await expect(
    tasks.getByRole("row", { name: /tenant\.member\.revoke/ }),
  ).toContainText("Waiting for approval");
  await tasks.getByRole("button", { name: "tenant.member.revoke" }).click();

  await expect(tasks).toContainText("op-task-1");
  await expect(tasks).toContainText("Organization admin: at least 1");
  await tasks.getByRole("button", { name: "Withdraw request" }).click();
  await tasks.getByRole("button", { name: "Confirm" }).click();

  await expect(tasks.getByRole("status")).toContainText(
    "The request is now: Withdrawn.",
  );
  await expect(tasks).toContainText(
    "The request was withdrawn. (APPROVAL_WITHDRAWN)",
  );
  await expect(
    tasks.getByRole("button", { name: "Withdraw request" }),
  ).toHaveCount(0);
  expect(
    (await kailoCalls(page)).filter((call) => call.method === "POST"),
  ).toEqual([expect.objectContaining({ path: `${APPROVAL_PATH}/withdraw` })]);
});

test("approvals: a decision is confirmed first, and an unknown answer is never shown as success or failure", async ({
  page,
}) => {
  await installMockBridge(page, {
    kailo: {
      routes: {
        "GET /api/v1/approvals": [{ status: 200, body: [waitingApproval] }],
        [`GET ${APPROVAL_PATH}`]: [{ status: 200, body: waitingApproval }],
        [`POST ${APPROVAL_PATH}/decision`]: [
          {
            status: 503,
            body: {
              class: "UNKNOWN",
              reason: "DEPENDENCY_UNAVAILABLE",
              operationId: "op-77",
            },
          },
          {
            status: 200,
            body: {
              approverPrincipalId: "principal-self",
              admitted: true,
              decision: "APPROVE",
              status: "APPROVED",
            },
          },
        ],
      },
    },
  });
  await page.goto("/#/platform/approvals");

  const approvals = page.getByTestId("platform-approvals");
  await approvals.getByRole("button", { name: "tenant.member.revoke" }).click();
  await approvals.getByRole("button", { name: "Approve" }).click();
  await expect(approvals).toContainText("cannot be changed afterwards");
  expect(
    (await kailoCalls(page)).filter((call) => call.method === "POST"),
  ).toHaveLength(0);
  await approvals.getByRole("button", { name: "Confirm" }).click();

  const alert = approvals.getByRole("alert");
  await expect(alert).toContainText("not known");
  await expect(alert).toContainText("op-77");
  await expect(alert).not.toContainText("not accepted");

  await approvals
    .getByRole("button", { name: "Send the same decision again" })
    .click();
  await expect(approvals.getByRole("status")).toContainText(
    "Your decision “Approve” is recorded",
  );
  expect(
    (await kailoCalls(page))
      .filter((call) => call.method === "POST")
      .map((call) => call.body),
  ).toEqual([{ decision: "APPROVE" }, { decision: "APPROVE" }]);
});

test("invitations: absent for non-admins", async ({ page }) => {
  // Default bridge: the invitation list answers 403, as the BFF does for non-admins.
  await installMockBridge(page);
  await page.goto("/#/platform/members");
  await expect(
    page.getByTestId("platform-members").getByRole("row").first(),
  ).toBeVisible();
  await expect(page.getByTestId("tenant-invitations")).toHaveCount(0);
});

test("invitations: an admin issues a link that is shown once, and withdraws it", async ({
  page,
}) => {
  const credential = "c".repeat(64);
  const link = `http://gateway.example/app/invite#${credential}`;
  const issued = {
    invitationId: "inv-1",
    inviteeLabel: "Grace from Ops",
    inviterPrincipalId: "principal-self",
    status: "ISSUED",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  };
  await installMockBridge(page, {
    kailo: {
      routes: {
        "GET /api/v1/invitations": [
          { status: 200, body: [] },
          { status: 200, body: [issued] },
          { status: 200, body: [{ ...issued, status: "REVOKED" }] },
        ],
        "POST /api/v1/actions": [
          {
            status: 200,
            body: {
              operationId: "op-1",
              actionExecutionId: "ae-1",
              actionKey: "tenant.member.invite",
              gateState: "ALLOWED",
              dispatchState: "DISPATCHED",
              invitation: {
                invitationId: "inv-1",
                link,
                expiresAt: issued.expiresAt,
              },
            },
          },
          {
            status: 200,
            body: {
              operationId: "op-2",
              actionExecutionId: "ae-2",
              actionKey: "tenant.member.invite.revoke",
              gateState: "ALLOWED",
              dispatchState: "DISPATCHED",
            },
          },
        ],
      },
    },
  });
  await page.goto("/#/platform/members");

  const section = page.getByTestId("tenant-invitations");
  await section.getByLabel("Who is this for?").fill("Grace from Ops");
  await section.getByRole("button", { name: "Create invitation link" }).click();
  const shown = section.getByTestId("issued-invitation");
  await expect(shown).toContainText("shown only this once");
  await expect(shown.getByRole("textbox")).toHaveValue(link);
  // The list never carries the credential; only the issuing reply did.
  await expect(section.getByRole("table")).not.toContainText(credential);

  await section
    .getByRole("row", { name: /Grace from Ops/ })
    .getByRole("button", { name: "Withdraw" })
    .click();
  await section.getByRole("button", { name: "Confirm" }).click();
  await expect(
    section.getByRole("row", { name: /Grace from Ops/ }),
  ).toContainText("Withdrawn");

  const posts = (await kailoCalls(page)).filter(
    (call) => call.method === "POST",
  );
  expect(posts.map((call) => call.body)).toEqual([
    expect.objectContaining({
      actionKey: "tenant.member.invite",
      name: "Grace from Ops",
    }),
    expect.objectContaining({
      actionKey: "tenant.member.invite.revoke",
      invitationId: "inv-1",
    }),
  ]);
});
