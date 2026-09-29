import { expect, type Page, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

// platform bootstrap on Desktop (DD-75/78/79): configure → sign in through
// the system browser → register this device's key until ACTIVE → fetch the
// community's connection facts → connect with apply_workspace. The platform_*
// commands are answered by the e2e bridge exactly as the Rust layer would.

const DEVICE_PUBKEY = "deadbeef".repeat(8);

type Logged = { command: string; payload: unknown };

async function log(page: Page): Promise<Logged[]> {
  return page.evaluate(
    () =>
      (
        window as Window & {
          __BUZZ_E2E_COMMAND_PAYLOADS__?: Array<{
            command: string;
            payload: unknown;
          }>;
        }
      ).__BUZZ_E2E_COMMAND_PAYLOADS__ ?? [],
  );
}

const bootstrap = (page: Page) => page.getByTestId("platform-bootstrap");

test("an unconfigured device asks for the deployment facts, with nothing prefilled", async ({
  page,
}) => {
  await installMockBridge(page, {
    platform: { config: null, signedIn: false },
  });
  await page.goto("/");

  await expect(
    bootstrap(page).getByRole("heading", { name: "Connect to your server" }),
  ).toBeVisible();
  const url = page.getByLabel("Native entry URL");
  const issuer = page.getByLabel("Sign-in issuer (OIDC)");
  const client = page.getByLabel("Client ID");
  for (const field of [url, issuer, client])
    await expect(field).toHaveValue("");

  await url.fill("https://platform.example.com:8091");
  await issuer.fill("https://idp.example.com/realms/platform");
  await client.fill("platform-native");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  expect(
    (await log(page)).find((entry) => entry.command === "platform_set_config")
      ?.payload,
  ).toEqual({
    config: {
      nativeApiUrl: "https://platform.example.com:8091",
      oidcIssuer: "https://idp.example.com/realms/platform",
      oidcClientId: "platform-native",
    },
  });
});

test("settings rejected by the Rust side stay on the form with the reason", async ({
  page,
}) => {
  await installMockBridge(page, {
    platform: {
      config: null,
      signedIn: false,
      setConfigError: "原生入口地址必须是 http 或 https 地址",
    },
  });
  await page.goto("/");

  await page.getByLabel("Native entry URL").fill("https://x.example");
  await page.getByLabel("Sign-in issuer (OIDC)").fill("https://i.example");
  await page.getByLabel("Client ID").fill("c");
  await page.getByRole("button", { name: "Save and continue" }).click();

  await expect(bootstrap(page).getByRole("alert")).toContainText(
    "http 或 https",
  );
  await expect(page.getByLabel("Native entry URL")).toHaveValue(
    "https://x.example",
  );
});

test("sign-in can be cancelled, and cancelling is not a failure", async ({
  page,
}) => {
  await installMockBridge(page, {
    platform: { signedIn: false, signIn: "hold" },
  });
  await page.goto("/");

  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(bootstrap(page)).toContainText(
    "Waiting for sign-in to finish in your browser",
  );
  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(bootstrap(page).getByRole("alert")).toHaveCount(0);
  expect((await log(page)).map((entry) => entry.command)).toContain(
    "platform_cancel_sign_in",
  );
});

test("sign-in → registration RECONCILING → ACTIVE → connects to the community the platform names", async ({
  page,
}) => {
  await installMockBridge(page, {
    platform: {
      signedIn: false,
      register: [
        {
          status: 202,
          body: {
            pubkey: DEVICE_PUBKEY,
            state: "RECONCILING",
            workflowId: "wf-device",
          },
        },
      ],
      deviceStates: ["RECONCILING", "ACTIVE"],
    },
  });
  await page.goto("/");

  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(bootstrap(page)).toContainText("RECONCILING");
  // No timer re-reads the list: the client has no basis for an interval, so
  // it only checks again when asked. Each check is one read.
  const check = page.getByRole("button", { name: "Check again" });
  await check.click();
  await expect(bootstrap(page)).toContainText("RECONCILING");
  await check.click();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();

  const entries = await log(page);
  expect(
    entries.filter(
      (entry) =>
        entry.command === "platform_api" &&
        (entry.payload as { path: string }).path ===
          "/api/v1/identity/client-keys",
    ),
  ).toHaveLength(2);
  const commands = entries.map((entry) => entry.command);
  expect(commands).toContain("platform_sign_in");
  expect(commands).toContain("platform_register_device");
  // The management plane goes through the Rust side only.
  expect(
    entries
      .filter((entry) => entry.command === "platform_api")
      .map((entry) => (entry.payload as { path: string }).path),
  ).toEqual(
    expect.arrayContaining([
      "/api/v1/identity/client-keys",
      "/api/v1/native/community",
    ]),
  );
  // Connected through the existing apply_workspace path, with the relay the
  // bootstrap was told about and no key material from the webview.
  const applied = entries.find((entry) => entry.command === "apply_workspace");
  expect(applied?.payload).toEqual({ relayUrl: "ws://localhost:3000" });
  expect(commands.indexOf("apply_workspace")).toBeGreaterThan(
    commands.lastIndexOf("platform_api"),
  );
});

test("a registration without an answer is shown as unknown, never as success or failure", async ({
  page,
}) => {
  await installMockBridge(page, {
    platform: {
      register: [
        { error: "平台服务不可达：operation timed out" },
        { status: 200, body: { pubkey: DEVICE_PUBKEY, state: "ACTIVE" } },
      ],
    },
  });
  await page.goto("/");

  await expect(bootstrap(page)).toContainText(
    "The registration result is unknown",
  );
  await expect(bootstrap(page).getByRole("alert")).toHaveCount(0);
  await expect(page.getByTestId("app-sidebar")).toHaveCount(0);

  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
});

test("a revoked device key is not revived and the app does not open", async ({
  page,
}) => {
  await installMockBridge(page, {
    platform: {
      register: [
        {
          status: 409,
          body: { class: "CONFLICT", reason: "CLIENT_KEY_ALREADY_BOUND" },
        },
      ],
    },
  });
  await page.goto("/");

  await expect(bootstrap(page).getByRole("alert")).toContainText(
    "has been revoked",
  );
  await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
  expect((await log(page)).map((entry) => entry.command)).not.toContain(
    "apply_workspace",
  );
});

test("missing connection facts keep the app closed and can be retried", async ({
  page,
}) => {
  await installMockBridge(page, {
    platform: {
      community: {
        status: 403,
        body: { class: "DENIED", reason: "NATIVE_SURFACE_REQUIRED" },
      },
    },
  });
  await page.goto("/");

  await expect(bootstrap(page).getByRole("alert")).toContainText(
    "NATIVE_SURFACE_REQUIRED",
  );
  await expect(page.getByTestId("app-sidebar")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("an expired session returns to sign-in instead of failing", async ({
  page,
}) => {
  await installMockBridge(page, {
    platform: { register: [{ error: "PLATFORM_NOT_SIGNED_IN" }] },
  });
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(bootstrap(page).getByRole("alert")).toHaveCount(0);
});
