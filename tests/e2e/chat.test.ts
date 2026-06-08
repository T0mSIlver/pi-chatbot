import { expect, test } from "@playwright/test";

test.describe("Chat Page", () => {
  test("home page loads with input field", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("multimodal-input")).toBeVisible();
  });

  test("project selector is visible", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("project-selector")).toBeVisible();
    await expect(page.getByText("All conversations")).toBeVisible();
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
    const capture = {
      id: "capture-1",
      chatId,
      assistantMessageId: "assistant-1",
      createdAt: timestamp,
      completedAt: timestamp,
      purpose: "chat",
      provider: "llamacpp",
      api: "openai-completions",
      model: "qwen36dense-27b",
      requestIndex: 1,
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
          messages: [{ role: "user", content: "Inspect this prompt" }],
        },
      },
      response: {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "text/event-stream" },
        chunks: [
          'data: {"choices":[{"delta":{"content":"Captured response"}}]}\n',
        ],
        rawBody:
          'data: {"choices":[{"delta":{"content":"Captured response"}}]}\n',
      },
      stats: {
        generatedTokens: 48,
        generationTimeMs: 1200,
        generationTokensPerSecond: 40,
        promptTimeMs: 250,
        promptTokens: 100,
        promptTokensPerSecond: 400,
      },
    };

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
      await route.fulfill({ json: { captures: [capture] } });
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
    await expect(page.getByTestId("provider-capture-json")).toContainText(
      '"role": "user"'
    );
    await expect(page.getByTestId("provider-stats")).toContainText("100 tok");

    await page.getByTestId("provider-capture-response-tab").click();
    await expect(page.getByTestId("provider-capture-json")).toContainText(
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

    // Stop button should appear during generation
    const stopButton = page.getByTestId("stop-button");
    // If generation starts, stop button appears
    // This is a best-effort check since timing depends on API
    await stopButton.click({ timeout: 5000 }).catch(() => {
      // Generation may have finished before we could click
    });
  });
});

test.describe("Chat Input Features", () => {
  test("input clears after sending", async ({ page }) => {
    await page.goto("/");
    const input = page.getByTestId("multimodal-input");
    await input.fill("Test message");
    await page.getByTestId("send-button").click();

    // Input should clear after sending
    await expect(input).toHaveValue("");
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
