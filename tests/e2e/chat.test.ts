import { expect, test } from "@playwright/test";

test.describe("Chat Page", () => {
  test("home page loads with input field", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("multimodal-input")).toBeVisible();
  });

  test("project selector is visible", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("project-selector")).toBeVisible();
    await expect(page.getByText("Standalone")).toBeVisible();
  });

  test("mobile history pane scrolls without idle loading spinner", async ({
    page,
  }) => {
    const projectId = "00000000-0000-4000-8000-000000000001";
    const userId = "00000000-0000-4000-8000-000000000002";
    const chats = Array.from({ length: 25 }, (_, index) => {
      const timestamp = new Date(Date.now() - index * 60_000);

      return {
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        createdAt: timestamp.toISOString(),
        updatedAt: timestamp.toISOString(),
        title: `Mobile history chat ${index + 1}`,
        summary: `Summary for mobile history chat ${index + 1}`,
        projectId,
        userId,
        workspacePath: `/tmp/mobile-history-chat-${index + 1}`,
        piSessionFilePath: `/tmp/mobile-history-chat-${index + 1}.jsonl`,
      };
    });

    await page.route("**/api/projects", async (route) => {
      const timestamp = new Date().toISOString();

      await route.fulfill({
        json: {
          projects: [
            {
              id: projectId,
              createdAt: timestamp,
              updatedAt: timestamp,
              name: "General",
              userId,
              workspacePath: "/tmp/mobile-history-project",
            },
          ],
        },
      });
    });

    await page.route("**/api/history**", async (route) => {
      const url = new URL(route.request().url());
      const endingBefore = url.searchParams.get("ending_before");
      const endingBeforeIndex = endingBefore
        ? chats.findIndex((chat) => chat.id === endingBefore)
        : -1;
      const startIndex = endingBefore
        ? endingBeforeIndex === -1
          ? chats.length
          : endingBeforeIndex + 1
        : 0;
      const pageSize = Number(url.searchParams.get("limit") ?? 20);
      const pageChats = chats.slice(startIndex, startIndex + pageSize);

      await route.fulfill({
        json: {
          chats: pageChats,
          hasMore: startIndex + pageSize < chats.length,
          projectId,
        },
      });
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByTestId("multimodal-input")).toBeVisible();

    await page.locator("header button").first().click();

    const dialog = page.getByRole("dialog", { name: "Sidebar" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Loading...")).toHaveCount(0);
    await expect(
      dialog.getByText("Mobile history chat 1", { exact: true })
    ).toBeVisible();

    const content = dialog.locator('[data-sidebar="content"]');
    const metrics = await content.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));

    expect(metrics.clientHeight).toBeLessThan(600);
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);

    await content.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect
      .poll(() => content.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);

    await content.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect
      .poll(() => content.evaluate((element) => element.scrollTop))
      .toBe(0);
  });

  test("opens OpenAI payload inspector from the sidebar", async ({
    baseURL,
    page,
  }) => {
    const timestamp = new Date().toISOString();
    const chatId = "00000000-0000-4000-8000-000000000101";
    const projectId = "00000000-0000-4000-8000-000000000102";
    const userId = "00000000-0000-4000-8000-000000000103";
    const createOpenAICapture = ({
      content,
      id,
      requestIndex,
      responseText,
    }: {
      content: string;
      id: string;
      requestIndex: number;
      responseText: string;
    }) => ({
      id,
      chatId,
      assistantMessageId: "assistant-1",
      createdAt: timestamp,
      completedAt: timestamp,
      purpose: "chat",
      provider: "llamacpp",
      api: "openai-completions",
      model: "qwen36dense-27b",
      requestIndex,
      request: {
        method: "POST",
        url: "http://model.local/v1/chat/completions",
        headers: {
          authorization: "[redacted]",
          "content-type": "application/json",
        },
        body: {
          model: "qwen36dense-27b",
          stream: true,
          messages: [{ role: "user", content }],
        },
      },
      response: {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "text/event-stream" },
        chunks: [
          `data: {"choices":[{"delta":{"content":"${responseText}"}}]}\n`,
        ],
        rawBody: `data: {"choices":[{"delta":{"content":"${responseText}"}}]}\n`,
      },
      stats: {
        generatedTokens: 48,
        generationTimeMs: 1200,
        generationTokensPerSecond: 40,
        promptTimeMs: 250,
        promptTokens: 100,
        promptTokensPerSecond: 400,
      },
    });
    const captures = [
      createOpenAICapture({
        content: "Inspect later prompt",
        id: "capture-11",
        requestIndex: 11,
        responseText: "Captured response 11",
      }),
      {
        id: "capture-fetch",
        chatId,
        assistantMessageId: "assistant-1",
        createdAt: timestamp,
        completedAt: timestamp,
        purpose: "chat",
        provider: "llamacpp",
        api: "openai-completions",
        model: "qwen36dense-27b",
        requestIndex: 111,
        request: {
          method: "GET",
          url: "https://reader.local/fetch?url=https%3A%2F%2Fexample.com",
          headers: {},
        },
        response: {
          status: 200,
          statusText: "OK",
          headers: { "content-type": "text/plain" },
          rawBody: "Fetched page body",
        },
      },
      createOpenAICapture({
        content: "Inspect middle prompt",
        id: "capture-2",
        requestIndex: 2,
        responseText: "Captured response 2",
      }),
      createOpenAICapture({
        content: "Inspect this prompt",
        id: "capture-1",
        requestIndex: 1,
        responseText: "Captured response",
      }),
    ];

    await page.context().addCookies([
      {
        name: "sidebar_state",
        value: "true",
        url: baseURL ?? "http://localhost:3000",
      },
    ]);

    await page.route("**/api/projects", async (route) => {
      await route.fulfill({
        json: {
          projects: [
            {
              id: projectId,
              createdAt: timestamp,
              updatedAt: timestamp,
              name: "General",
              userId,
              workspacePath: "/tmp/provider-capture-project",
            },
          ],
        },
      });
    });

    await page.route("**/api/history**", async (route) => {
      await route.fulfill({
        json: {
          chats: [
            {
              id: chatId,
              createdAt: timestamp,
              updatedAt: timestamp,
              title: "Payload debug chat",
              summary: "Inspect provider payloads",
              projectId,
              userId,
              workspacePath: "/tmp/provider-capture-chat",
              piSessionFilePath: "/tmp/provider-capture-chat.jsonl",
            },
          ],
          hasMore: false,
          projectId,
        },
      });
    });

    await page.route("**/api/chat/**/provider-captures", async (route) => {
      await route.fulfill({ json: { captures } });
    });

    await page.goto("/");
    const row = page
      .locator('[data-sidebar="menu-item"]')
      .filter({ hasText: "Payload debug chat" });
    await expect(row).toBeVisible();
    await row.hover();
    await row.locator('[data-sidebar="menu-action"]').click();
    await page.getByTestId("inspect-openai-payload-item").click();

    await expect(page.getByTestId("provider-capture-dialog")).toBeVisible();
    const listItems = page.getByTestId("provider-capture-list-item");
    await expect(listItems).toHaveCount(3);
    await expect(listItems.nth(0).locator("span").first()).toHaveText(
      "Request 1"
    );
    await expect(listItems.nth(1).locator("span").first()).toHaveText(
      "Request 2"
    );
    await expect(listItems.nth(2).locator("span").first()).toHaveText(
      "Request 11"
    );

    const requestPanel = page.getByTestId("provider-capture-request");
    await expect(requestPanel).toContainText("user");
    await expect(requestPanel).toContainText("Inspect this prompt");
    await expect(requestPanel).not.toContainText("Fetched page body");
    await expect(page.getByTestId("provider-stats")).toContainText("100 tok");

    await page.getByTestId("provider-capture-response-tab").click();
    await expect(page.getByTestId("provider-capture-response")).toContainText(
      "Captured response"
    );
    await page.getByTestId("provider-stats-generation").click();
    await expect(page.getByTestId("provider-stats")).toContainText("48 tok");
  });

  test("shows provider stats below assistant messages", async ({ page }) => {
    const timestamp = new Date().toISOString();
    const chatId = "00000000-0000-4000-8000-000000000201";

    await page.route("**/api/messages**", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("chatId") !== chatId) {
        await route.continue();
        return;
      }

      await route.fulfill({
        json: {
          isReadonly: false,
          messages: [
            {
              id: "user-message",
              metadata: { createdAt: timestamp },
              parts: [{ type: "text", text: "Show stats" }],
              role: "user",
            },
            {
              id: "assistant-message",
              metadata: {
                createdAt: timestamp,
                providerStats: {
                  generatedTokens: 64,
                  generationTimeMs: 2000,
                  generationTokensPerSecond: 32,
                  promptTimeMs: 400,
                  promptTokens: 128,
                  promptTokensPerSecond: 320,
                },
              },
              parts: [{ type: "text", text: "Stats are visible." }],
              role: "assistant",
            },
          ],
          projectId: "00000000-0000-4000-8000-000000000202",
          userId: "00000000-0000-4000-8000-000000000203",
        },
      });
    });

    await page.goto(`/chat/${chatId}`);

    const stats = page.getByTestId("provider-stats");
    await expect(stats).toContainText("128 tok");
    await page.getByTestId("provider-stats-generation").click();
    await expect(stats).toContainText("64 tok");
  });

  test("shows controls and stats only on final assistant answers", async ({
    page,
  }) => {
    const timestamp = new Date().toISOString();
    const chatId = "00000000-0000-4000-8000-000000000204";

    await page.route("**/api/messages**", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("chatId") !== chatId) {
        await route.continue();
        return;
      }

      await route.fulfill({
        json: {
          isReadonly: false,
          messages: [
            {
              id: "user-message",
              metadata: { createdAt: timestamp },
              parts: [{ type: "text", text: "Inspect the project" }],
              role: "user",
            },
            {
              id: "assistant-tool-message",
              metadata: {
                createdAt: timestamp,
                providerStats: { promptTokens: 100 },
              },
              parts: [
                {
                  state: "done",
                  text: "I should inspect a file.",
                  type: "reasoning",
                },
                {
                  input: { path: "README.md" },
                  state: "output-available",
                  toolCallId: "tool-call",
                  toolName: "read",
                  type: "tool-pi",
                },
              ],
              role: "assistant",
            },
            {
              id: "assistant-final-message",
              metadata: {
                createdAt: timestamp,
                providerStats: {
                  generatedTokens: 50,
                  promptTokens: 300,
                },
              },
              parts: [
                {
                  state: "done",
                  text: "The file contains the project overview.",
                  type: "reasoning",
                },
                { type: "text", text: "Here is the final answer." },
              ],
              role: "assistant",
            },
          ],
          projectId: "00000000-0000-4000-8000-000000000205",
          userId: "00000000-0000-4000-8000-000000000206",
        },
      });
    });

    await page.goto(`/chat/${chatId}`);

    const userMessage = page.getByTestId("message-user");
    await expect(
      userMessage.getByRole("button", { name: "Copy" })
    ).toHaveCount(1);
    await expect(
      userMessage.getByRole("button", { name: "Edit" })
    ).toHaveCount(1);
    await expect(
      userMessage.getByRole("button", { name: "Branch" })
    ).toHaveCount(0);

    const assistantMessages = page.getByTestId("message-assistant");
    const toolMessage = assistantMessages.nth(0);
    await expect(toolMessage.getByTestId("provider-stats")).toHaveCount(0);
    await expect(
      toolMessage.getByRole("button", { name: "Copy" })
    ).toHaveCount(0);
    await expect(
      toolMessage.getByRole("button", { name: "Regenerate" })
    ).toHaveCount(0);
    await expect(
      toolMessage.getByRole("button", { name: "Branch" })
    ).toHaveCount(0);

    const finalMessage = assistantMessages.nth(1);
    await expect(finalMessage.getByTestId("provider-stats")).toContainText(
      "300 tok"
    );
    await expect(
      finalMessage.getByRole("button", { name: "Copy" })
    ).toHaveCount(1);
    await expect(
      finalMessage.getByRole("button", { name: "Regenerate" })
    ).toHaveCount(1);
    await expect(
      finalMessage.getByRole("button", { name: "Branch" })
    ).toHaveCount(1);
  });

  test("shows prompt action buttons on touch devices without hover", async ({
    baseURL,
    browser,
  }) => {
    const timestamp = new Date().toISOString();
    const chatId = "00000000-0000-4000-8000-000000000207";
    const context = await browser.newContext({
      hasTouch: true,
      isMobile: true,
      viewport: { width: 820, height: 1180 },
    });
    const page = await context.newPage();

    try {
      await page.route("**/api/messages**", async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get("chatId") !== chatId) {
          await route.continue();
          return;
        }

        await route.fulfill({
          json: {
            isReadonly: false,
            messages: [
              {
                id: "user-message",
                metadata: { createdAt: timestamp },
                parts: [
                  { type: "text", text: "Visible mobile prompt actions" },
                ],
                role: "user",
              },
            ],
            projectId: "00000000-0000-4000-8000-000000000208",
            userId: "00000000-0000-4000-8000-000000000209",
          },
        });
      });

      await page.goto(
        new URL(`/chat/${chatId}`, baseURL ?? "http://localhost:3000").href
      );

      await expect
        .poll(() => page.evaluate(() => matchMedia("(hover: hover)").matches))
        .toBe(false);

      const userMessage = page.getByTestId("message-user");
      await expect(
        userMessage.getByRole("button", { name: "Copy" })
      ).toHaveCount(1);
      await expect(
        userMessage.getByRole("button", { name: "Edit" })
      ).toHaveCount(1);
      await expect
        .poll(() =>
          userMessage
            .getByTestId("message-actions")
            .evaluate((element) => getComputedStyle(element).opacity)
        )
        .toBe("1");
    } finally {
      await context.close();
    }
  });

  test("copies prompt and response text to the clipboard", async ({
    baseURL,
    context,
    page,
  }) => {
    const timestamp = new Date().toISOString();
    const chatId = "00000000-0000-4000-8000-000000000301";

    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: baseURL ?? "http://localhost:3000",
    });
    await page.route("**/api/messages**", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("chatId") !== chatId) {
        await route.continue();
        return;
      }

      await route.fulfill({
        json: {
          isReadonly: false,
          messages: [
            {
              id: "user-message",
              metadata: { createdAt: timestamp },
              parts: [{ type: "text", text: "Prompt to copy" }],
              role: "user",
            },
            {
              id: "assistant-message",
              metadata: { createdAt: timestamp },
              parts: [{ type: "text", text: "Response to copy." }],
              role: "assistant",
            },
          ],
          projectId: "00000000-0000-4000-8000-000000000302",
          userId: "00000000-0000-4000-8000-000000000303",
        },
      });
    });

    await page.goto(`/chat/${chatId}`);

    const userMessage = page.getByTestId("message-user");
    await userMessage.hover();
    await userMessage.getByRole("button", { name: "Copy" }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("Prompt to copy");

    const assistantMessage = page.getByTestId("message-assistant");
    await assistantMessage.hover();
    await assistantMessage.getByRole("button", { name: "Copy" }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("Response to copy.");
  });

  test("can type in the input field", async ({ page }) => {
    await page.goto("/");
    const input = page.getByTestId("multimodal-input");
    await input.fill("Hello world");
    await expect(input).toHaveValue("Hello world");
  });

  test("submit button is visible", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("send-button")).toBeVisible();
  });

  test("suggested actions are visible on empty chat", async ({ page }) => {
    await page.goto("/");
    const suggestions = page.locator("[data-testid='suggested-actions']");
    await expect(suggestions).toBeVisible();
  });

  test("can stop generation with stop button", async ({ page }) => {
    await page.goto("/");

    // Type and send a message
    await page.getByTestId("multimodal-input").fill("Hello");
    await page.getByTestId("send-button").click();

    const stopButton = page.getByTestId("stop-button");
    await stopButton.click({ timeout: 5000 }).catch(() => undefined);
    await expect(stopButton).toBeHidden({ timeout: 30_000 });
  });
});

test.describe("Chat Input Features", () => {
  test("input clears after sending", async ({ page }) => {
    await page.goto("/");
    const input = page.getByTestId("multimodal-input");
    await input.fill("Test message");
    await page.getByTestId("send-button").click();

    await expect(input).toHaveValue("");
    await expect(page.getByText("This is a mocked Pi response")).toBeVisible({
      timeout: 30_000,
    });
  });

  test("sidebar updates with generated title without refresh", async ({
    page,
  }) => {
    const title = `Sidebar title ${Date.now()}`;

    await page.goto("/");
    await page.getByTestId("multimodal-input").fill(title);
    await page.getByTestId("send-button").click();

    await expect(page.locator('[data-sidebar="sidebar"]')).toContainText(title);
  });

  test("input supports multiline text", async ({ page }) => {
    await page.goto("/");
    const input = page.getByTestId("multimodal-input");
    await input.fill("Line 1\nLine 2\nLine 3");
    await expect(input).toContainText("Line 1");
  });
});
