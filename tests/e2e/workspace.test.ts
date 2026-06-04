import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

const CHAT_URL_REGEX = /\/chat\/[\w-]+/;

async function createMockWorkspaceTurn(page: import("@playwright/test").Page) {
  const projectsResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/projects") && response.status() === 200
  );
  await page.goto("/");
  await projectsResponse;
  await expect(page.getByTestId("project-selector")).not.toContainText(
    "Loading...",
    { timeout: 30_000 }
  );
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

  test("plans and restores conversation and shared workspace checkpoints", async ({
    page,
  }) => {
    const chatId = await createMockWorkspaceTurn(page);

    const plan = await page.request.post("/api/workspace/restore/plan", {
      data: { chatId, checkpointId: "root" },
    });
    expect(plan.status()).toBe(200);
    const planBody = (await plan.json()) as {
      changes: Array<{ scope: string; path: string; change: string }>;
      missingCheckpoint: boolean;
    };
    expect(planBody.missingCheckpoint).toBe(false);
    expect(planBody.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: "conversation",
          path: "mock-output.md",
          change: "deleted",
        }),
        expect.objectContaining({
          scope: "shared",
          path: "shared-note.txt",
          change: "deleted",
        }),
      ])
    );

    const unconfirmed = await page.request.post("/api/workspace/restore", {
      data: { chatId, checkpointId: "root", confirmed: false },
    });
    expect(unconfirmed.status()).toBe(400);

    const restore = await page.request.post("/api/workspace/restore", {
      data: { chatId, checkpointId: "root", confirmed: true },
    });
    expect(restore.status()).toBe(200);

    const conversationFile = await page.request.get(
      `/api/workspace/file?chatId=${chatId}&scope=conversation&path=mock-output.md`
    );
    expect(conversationFile.status()).toBe(400);

    const sharedFile = await page.request.get(
      `/api/workspace/file?chatId=${chatId}&scope=shared&path=shared-note.txt`
    );
    expect(sharedFile.status()).toBe(400);
  });

  test("loads only the active Pi branch after branching before a user message", async ({
    page,
  }) => {
    const chatId = await createMockWorkspaceTurn(page);
    const messagesResponse = await page.request.get(
      `/api/messages?chatId=${chatId}`
    );
    const messagesBody = (await messagesResponse.json()) as {
      projectId: string;
    };

    const branchResponse = await page.request.post("/api/chat", {
      data: {
        id: chatId,
        projectId: messagesBody.projectId,
        selectedChatModel: "test/model",
        branchFromEntryId: null,
        message: {
          id: randomUUID(),
          role: "user",
          parts: [{ type: "text", text: "Edited branch message" }],
        },
      },
    });
    expect(branchResponse.status()).toBe(200);
    await branchResponse.text();

    const updatedMessages = await page.request.get(
      `/api/messages?chatId=${chatId}`
    );
    const updatedBody = (await updatedMessages.json()) as {
      messages: Array<{ role: string; parts: Array<{ text?: string }> }>;
    };
    const transcript = JSON.stringify(updatedBody.messages);
    expect(transcript).toContain("Edited branch message");
    expect(transcript).not.toContain("Create workspace files");
  });

  test("branches a chat and restores selected checkpoint files", async ({
    page,
  }) => {
    const chatId = await createMockWorkspaceTurn(page);
    const messagesResponse = await page.request.get(
      `/api/messages?chatId=${chatId}`
    );
    const messagesBody = (await messagesResponse.json()) as {
      messages: Array<{
        role: string;
        metadata?: { checkpointId?: string };
      }>;
    };
    const assistant = messagesBody.messages.find(
      (message) => message.role === "assistant"
    );
    const checkpointId = assistant?.metadata?.checkpointId;
    expect(checkpointId).toBeTruthy();

    const branch = await page.request.post("/api/chat/branch", {
      data: {
        chatId,
        entryId: checkpointId,
        restoreCheckpointId: checkpointId,
        confirmedRestore: true,
      },
    });
    expect(branch.status()).toBe(200);
    const branchBody = (await branch.json()) as { chatId: string };

    const branchedFile = await page.request.get(
      `/api/workspace/file?chatId=${branchBody.chatId}&scope=conversation&path=mock-output.md`
    );
    expect(branchedFile.status()).toBe(200);
    expect((await branchedFile.json()).file.content).toContain(
      "Mock workspace output"
    );
  });

  test("warns before restoring files for edit and cancels without writes", async ({
    page,
  }) => {
    const chatId = await createMockWorkspaceTurn(page);

    await page.getByTestId("message-user").first().hover();
    await page.getByRole("button", { name: "Edit" }).click();
    await expect(page.getByTestId("editing-message-banner")).toBeVisible();

    await page.getByTestId("multimodal-input").fill("Edited workspace files");
    await page.getByTestId("send-button").click();

    await expect(page.getByTestId("workspace-restore-warning")).toBeVisible();
    const warning = page.getByTestId("workspace-restore-warning");
    await expect(warning.getByText("Conversation workspace")).toBeVisible();
    await expect(warning.getByText("Project shared workspace")).toBeVisible();
    await expect(warning.getByText("mock-output.md")).toBeVisible();
    await expect(warning.getByText("shared-note.txt")).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("workspace-restore-warning")).toBeHidden({
      timeout: 5000,
    });

    const conversationFile = await page.request.get(
      `/api/workspace/file?chatId=${chatId}&scope=conversation&path=mock-output.md`
    );
    expect(conversationFile.status()).toBe(200);

    const sharedFile = await page.request.get(
      `/api/workspace/file?chatId=${chatId}&scope=shared&path=shared-note.txt`
    );
    expect(sharedFile.status()).toBe(200);
  });
});
