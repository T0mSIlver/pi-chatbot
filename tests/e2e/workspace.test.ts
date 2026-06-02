import { expect, test } from "@playwright/test";

const CHAT_URL_REGEX = /\/chat\/[\w-]+/;

async function createMockWorkspaceTurn(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByTestId("multimodal-input").fill("Create workspace files");
  await page.getByTestId("send-button").click();
  await expect(page).toHaveURL(CHAT_URL_REGEX, { timeout: 10_000 });
  await expect(page.getByText("This is a mocked Pi response")).toBeVisible({
    timeout: 30_000,
  });
  const chatId = page.url().split("/chat/").at(-1) ?? "";
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `/api/workspace/changes?chatId=${chatId}`
      );
      if (!response.ok()) {
        return 0;
      }
      return ((await response.json()) as { changes: unknown[] }).changes.length;
    })
    .toBeGreaterThan(0);

  return chatId;
}

test.describe("Workspace file workbench", () => {
  test("opens and closes an empty files pane", async ({ page }) => {
    await page.goto("/");

    await page.getByTestId("workspace-files-button").click();
    await expect(page.getByTestId("workspace-workbench")).toBeVisible();
    await expect(
      page.getByText("No workspace is available for this chat yet.")
    ).toBeVisible();

    await page.getByTestId("workspace-workbench-close").click();
    await expect(page.getByTestId("workspace-workbench")).toBeHidden();
  });

  test("tracks changed files and opens showcase previews", async ({ page }) => {
    await createMockWorkspaceTurn(page);

    await expect(page.getByTestId("workspace-workbench")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Mock workspace output").first()).toBeVisible();
    await expect(page.getByTestId("workspace-open-preview")).toBeVisible();

    await page.getByTestId("workspace-workbench-close").click();
    await page.getByTestId("workspace-open-preview").click();
    await expect(page.getByTestId("workspace-workbench")).toBeVisible();
    await expect(page.getByText("Mock workspace output").first()).toBeVisible();

    await page.getByTestId("workspace-tab-changed").click();
    await expect(
      page.getByRole("button", { name: /mock-output\.md Created/ })
    ).toBeVisible();
    await expect(page.getByText("Created").first()).toBeVisible();

    await page
      .getByRole("button", { name: /apps\/mock\/index\.html Created/ })
      .click();
    const frame = page.frameLocator("iframe[title='index.html']");
    await expect(frame.getByText("Mock app")).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("workspace-open-preview")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByTestId("workspace-open-preview").click();
    await expect(page.getByTestId("workspace-workbench")).toBeVisible();
    await expect(page.getByText("Mock workspace output").first()).toBeVisible();
  });
});

test.describe("Workspace file APIs", () => {
  test("read files and reject unsafe paths", async ({ page }) => {
    const chatId = await createMockWorkspaceTurn(page);

    const conversationFile = await page.request.get(
      `/api/workspace/file?chatId=${chatId}&scope=conversation&path=mock-output.md`
    );
    expect(conversationFile.status()).toBe(200);
    expect((await conversationFile.json()).file.content).toContain(
      "Mock workspace output"
    );

    const sharedFile = await page.request.get(
      `/api/workspace/file?chatId=${chatId}&scope=shared&path=shared-note.txt`
    );
    expect(sharedFile.status()).toBe(200);
    expect((await sharedFile.json()).file.content).toContain(
      "Shared workspace note"
    );

    const traversal = await page.request.get(
      `/api/workspace/file?chatId=${chatId}&scope=conversation&path=../mock-output.md`
    );
    expect(traversal.status()).toBe(400);

    const absolute = await page.request.get(
      `/api/workspace/file?chatId=${chatId}&scope=conversation&path=/tmp/mock-output.md`
    );
    expect(absolute.status()).toBe(400);

    const symlink = await page.request.get(
      `/api/workspace/file?chatId=${chatId}&scope=conversation&path=project-shared/shared-note.txt`
    );
    expect(symlink.status()).toBe(400);

    const tree = await page.request.get(`/api/workspace/tree?chatId=${chatId}`);
    const treeText = JSON.stringify(await tree.json());
    expect(treeText).not.toContain(".pi-chatbot");
    expect(treeText).not.toContain("pi-session.jsonl");
    expect(treeText).not.toContain("project-shared");
  });
});
