import { randomUUID } from "node:crypto";
import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";

const CHAT_URL_REGEX = /\/chat\/[\w-]+/;
const ERROR_TEXT_REGEX = /error|failed|trouble/i;
const DEFAULT_TEST_MODEL = "llamacpp/qwen36dense-27b";

async function gotoHomeWithProject(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("project-selector")).not.toContainText(
    "Loading...",
    { timeout: 30_000 }
  );
}

async function sendSlowBackgroundMessage(page: Page, message: string) {
  const chatResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/chat") &&
      response.request().method() === "POST" &&
      response.status() === 200
  );

  await page.getByTestId("multimodal-input").fill(message);
  await page.getByTestId("send-button").click();
  await chatResponse;
  await expect(page).toHaveURL(CHAT_URL_REGEX, { timeout: 10_000 });

  const chatId = page.url().split("/chat/").at(-1);
  expect(chatId).toBeTruthy();
  return chatId ?? "";
}

async function createProject(page: Page, name = `API project ${Date.now()}`) {
  const response = await page.request.post("/api/projects", {
    data: { name },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { project: { id: string; name: string } })
    .project;
}

async function createProjectViaRequest(
  request: APIRequestContext,
  name = `API project ${Date.now()}`
) {
  const response = await request.post("/api/projects", {
    data: { name },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { project: { id: string; name: string } })
    .project;
}

async function createChatViaApi({
  page,
  projectId,
  text,
}: {
  page: Page;
  projectId?: string;
  text: string;
}) {
  const id = randomUUID();
  const response = await page.request.post("/api/chat", {
    data: {
      id,
      projectId,
      selectedChatModel: DEFAULT_TEST_MODEL,
      message: {
        id: randomUUID(),
        role: "user",
        parts: [{ type: "text", text }],
      },
    },
  });

  expect(response.status()).toBe(200);
  await response.text();
  return id;
}

test.describe("Chat API Integration", () => {
  test("sends message and receives AI response", async ({ page }) => {
    await gotoHomeWithProject(page);

    const input = page.getByTestId("multimodal-input");
    await input.fill("Hello");
    await page.getByTestId("send-button").click();

    // Wait for assistant response to appear
    const assistantMessage = page.locator("[data-role='assistant']").first();
    await expect(assistantMessage).toBeVisible({ timeout: 30_000 });

    // Verify it has some text content
    const content = await assistantMessage.textContent();
    expect(content?.length).toBeGreaterThan(0);
  });

  test("renders Pi tool blocks", async ({ page }) => {
    await gotoHomeWithProject(page);

    await page.getByTestId("multimodal-input").fill("Use a tool");
    await page.getByTestId("send-button").click();

    const toolBlock = page.getByTestId("pi-tool-block").first();
    await expect(toolBlock).toBeVisible({
      timeout: 30_000,
    });
    await expect(toolBlock).toContainText("read");
  });

  test("renders interleaved thinking inline around tool calls", async ({
    page,
  }) => {
    await gotoHomeWithProject(page);

    await page.getByTestId("multimodal-input").fill("Interleaved thinking");
    await page.getByTestId("send-button").click();

    await expect(page.getByText("This is a mocked Pi response")).toBeVisible({
      timeout: 30_000,
    });

    const assistantMessage = page.locator("[data-role='assistant']").first();
    await expect(assistantMessage.getByTestId("message-reasoning")).toHaveCount(
      2
    );
    await expect(assistantMessage.getByTestId("pi-tool-block")).toHaveCount(1);

    const orderedBlocks = assistantMessage.locator(
      '[data-testid="message-reasoning"], [data-testid="pi-tool-block"], [data-testid="message-content"]'
    );
    await expect(orderedBlocks).toHaveCount(4);
    await expect(orderedBlocks.nth(0)).toHaveAttribute(
      "data-testid",
      "message-reasoning"
    );
    await expect(orderedBlocks.nth(1)).toHaveAttribute(
      "data-testid",
      "pi-tool-block"
    );
    await expect(orderedBlocks.nth(2)).toHaveAttribute(
      "data-testid",
      "message-reasoning"
    );
    await expect(orderedBlocks.nth(3)).toHaveAttribute(
      "data-testid",
      "message-content"
    );
  });

  test("redirects to /chat/:id after sending message", async ({ page }) => {
    await gotoHomeWithProject(page);

    const input = page.getByTestId("multimodal-input");
    await input.fill("Test redirect");
    await page.getByTestId("send-button").click();

    // URL should change to /chat/:id format
    await expect(page).toHaveURL(CHAT_URL_REGEX, { timeout: 10_000 });
  });

  test("returns no provider captures before any real captures are recorded", async ({
    page,
  }) => {
    await gotoHomeWithProject(page);

    const chatId = await sendSlowBackgroundMessage(
      page,
      `Provider captures empty ${Date.now()}`
    );
    const response = await page.request.get(
      `/api/chat/${chatId}/provider-captures`
    );

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ captures: [] });
  });

  test("shares chat history across guest browser sessions", async ({
    browser,
  }) => {
    const firstContext = await browser.newContext();
    const secondContext = await browser.newContext();
    const firstPage = await firstContext.newPage();
    const secondPage = await secondContext.newPage();
    let chatId: string | undefined;

    try {
      const title = `E2E cross-session verification ${Date.now()}`;

      await gotoHomeWithProject(firstPage);
      await firstPage.getByTestId("multimodal-input").fill(title);
      await firstPage.getByTestId("send-button").click();
      await expect(firstPage).toHaveURL(CHAT_URL_REGEX, { timeout: 10_000 });
      await expect(
        firstPage.getByText("This is a mocked Pi response")
      ).toBeVisible({
        timeout: 30_000,
      });

      chatId = firstPage.url().split("/chat/").at(-1);
      expect(chatId).toBeTruthy();

      const firstMessagesResponse = await firstPage.request.get(
        `/api/messages?chatId=${chatId}`
      );
      expect(firstMessagesResponse.status()).toBe(200);

      await gotoHomeWithProject(secondPage);

      const secondMessagesResponse = await secondPage.request.get(
        `/api/messages?chatId=${chatId}`
      );
      expect(secondMessagesResponse.status()).toBe(200);
      expect(JSON.stringify(await secondMessagesResponse.json())).toContain(
        title
      );

      const historyResponse = await secondPage.request.get(
        "/api/history?limit=20"
      );
      expect(historyResponse.status()).toBe(200);
      expect(JSON.stringify(await historyResponse.json())).toContain(chatId);
    } finally {
      if (chatId) {
        await firstPage.request.delete(`/api/chat?id=${chatId}`);
      }
      await firstContext.close();
      await secondContext.close();
    }
  });

  test("separates standalone and project chat history", async ({ page }) => {
    await gotoHomeWithProject(page);
    const standaloneText = `Standalone API chat ${Date.now()}`;
    const standaloneChatId = await createChatViaApi({
      page,
      text: standaloneText,
    });
    const project = await createProject(page);
    const projectText = `Project API chat ${Date.now()}`;
    const projectChatId = await createChatViaApi({
      page,
      projectId: project.id,
      text: projectText,
    });

    try {
      const standaloneMessages = await page.request.get(
        `/api/messages?chatId=${standaloneChatId}`
      );
      expect(standaloneMessages.status()).toBe(200);
      expect((await standaloneMessages.json()).projectId).toBeNull();

      const standaloneHistory = await page.request.get(
        "/api/history?limit=20&scope=standalone"
      );
      expect(standaloneHistory.status()).toBe(200);
      const standaloneHistoryText = JSON.stringify(
        await standaloneHistory.json()
      );
      expect(standaloneHistoryText).toContain(standaloneChatId);
      expect(standaloneHistoryText).not.toContain(projectChatId);

      const projectHistory = await page.request.get(
        `/api/history?limit=20&projectId=${project.id}`
      );
      expect(projectHistory.status()).toBe(200);
      const projectHistoryText = JSON.stringify(await projectHistory.json());
      expect(projectHistoryText).toContain(projectChatId);
      expect(projectHistoryText).not.toContain(standaloneChatId);
    } finally {
      await page.request.delete(`/api/chat?id=${standaloneChatId}`);
      await page.request.delete(`/api/chat?id=${projectChatId}`);
      await page.request.delete(`/api/projects/${project.id}`);
    }
  });

  test("saves MCP catalog and applies project/chat inheritance", async ({
    page,
  }) => {
    await gotoHomeWithProject(page);
    const project = await createProject(page);
    const chatId = await createChatViaApi({
      page,
      projectId: project.id,
      text: `MCP toggle chat ${Date.now()}`,
    });

    try {
      const catalogResponse = await page.request.patch("/api/mcp/config", {
        data: {
          json: JSON.stringify({
            settings: { idleTimeout: 3 },
            mcpServers: {
              fake: {
                command: "node",
                args: ["-e", "process.exit(0)"],
                env: { ATHLETE_ID: 870_422 },
              },
            },
          }),
        },
      });
      expect(catalogResponse.status()).toBe(200);
      const catalogBody = await catalogResponse.json();
      expect(JSON.stringify(catalogBody)).toContain("fake");
      expect(catalogBody.json).toContain('"ATHLETE_ID": "870422"');

      const projectToggle = await page.request.patch(
        `/api/projects/${project.id}/mcp`,
        { data: { servers: { fake: true } } }
      );
      expect(projectToggle.status()).toBe(200);
      expect((await projectToggle.json()).servers[0]).toMatchObject({
        id: "fake",
        enabled: true,
      });

      const inheritedChat = await page.request.get(`/api/chat/${chatId}/mcp`);
      expect(inheritedChat.status()).toBe(200);
      expect((await inheritedChat.json()).servers[0]).toMatchObject({
        id: "fake",
        defaultEnabled: true,
        effectiveEnabled: true,
        override: "inherit",
      });

      const disabledChat = await page.request.patch(`/api/chat/${chatId}/mcp`, {
        data: { overrides: { fake: "disabled" } },
      });
      expect(disabledChat.status()).toBe(200);
      expect((await disabledChat.json()).servers[0]).toMatchObject({
        id: "fake",
        defaultEnabled: true,
        effectiveEnabled: false,
        override: "disabled",
      });
    } finally {
      await page.request.delete(`/api/chat?id=${chatId}`);
      await page.request.delete(`/api/projects/${project.id}`);
      await page.request.patch("/api/mcp/config", {
        data: { json: JSON.stringify({ mcpServers: {} }) },
      });
    }
  });

  test("adds MCP servers through guided API and probes ping status", async ({
    request,
  }) => {
    const signIn = await request.get("/api/auth/guest?redirectUrl=/");
    expect(signIn.status()).toBe(200);

    const project = await createProjectViaRequest(request);
    const goodId = `ping-${Date.now()}`;
    const badId = `bad-url-${Date.now()}`;
    const mcpServerScript =
      'const readline=require("node:readline");const rl=readline.createInterface({input:process.stdin});rl.on("line",(line)=>{const message=JSON.parse(line);if(message.method==="initialize"){console.log(JSON.stringify({jsonrpc:"2.0",id:message.id,result:{protocolVersion:message.params.protocolVersion,capabilities:{},serverInfo:{name:"test-mcp",version:"1.0.0"}}}));}else if(message.method==="ping"){console.log(JSON.stringify({jsonrpc:"2.0",id:message.id,result:{}}));}});';

    try {
      const addCommand = await request.post("/api/mcp/config/servers", {
        data: {
          command: `node -e '${mcpServerScript}'`,
          id: goodId,
          mode: "command",
        },
      });
      expect(addCommand.status()).toBe(201);
      expect((await addCommand.json()).json).toContain(goodId);

      const duplicate = await request.post("/api/mcp/config/servers", {
        data: {
          command: `node -e '${mcpServerScript}'`,
          id: goodId,
          mode: "command",
        },
      });
      expect(duplicate.status()).toBe(400);
      expect((await duplicate.json()).cause).toContain("already exists");

      const addUrl = await request.post("/api/mcp/config/servers", {
        data: {
          id: badId,
          mode: "url",
          url: "http://127.0.0.1:1/mcp",
        },
      });
      expect(addUrl.status()).toBe(201);

      const projectToggle = await request.patch(
        `/api/projects/${project.id}/mcp`,
        { data: { servers: { [goodId]: true, [badId]: false } } }
      );
      expect(projectToggle.status()).toBe(200);

      const status = await request.post("/api/mcp/status", {
        data: { projectId: project.id, serverIds: [goodId, badId] },
        timeout: 15_000,
      });
      expect(status.status()).toBe(200);

      const body = (await status.json()) as {
        servers: Array<{
          connectionState: string;
          effectiveEnabled: boolean;
          enablementSource: string;
          id: string;
          message?: string;
        }>;
      };
      const good = body.servers.find((server) => server.id === goodId);
      const bad = body.servers.find((server) => server.id === badId);

      expect(good).toMatchObject({
        connectionState: "connected",
        effectiveEnabled: true,
        enablementSource: "project-enabled",
      });
      expect(bad?.connectionState).toMatch(/error|timeout/);
      expect(JSON.stringify(body)).not.toContain("secret");
    } finally {
      await request.delete(`/api/projects/${project.id}`);
      await request.patch("/api/mcp/config", {
        data: { json: JSON.stringify({ mcpServers: {} }) },
      });
    }
  });

  test("finishes a background response after the initiating tab closes", async ({
    browser,
  }) => {
    const firstContext = await browser.newContext();
    const firstPage = await firstContext.newPage();
    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    let chatId = "";

    try {
      await gotoHomeWithProject(firstPage);
      chatId = await sendSlowBackgroundMessage(
        firstPage,
        `Slow background close ${Date.now()}`
      );
      await firstPage.close();

      await secondPage.goto(`/chat/${chatId}`);
      await expect(
        secondPage.getByText("This is a mocked Pi response")
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      if (chatId) {
        await secondPage.request.delete(`/api/chat?id=${chatId}`);
      }
      await firstContext.close();
      await secondContext.close();
    }
  });

  test("reattaches to a running response after reload", async ({ page }) => {
    await gotoHomeWithProject(page);
    const chatId = await sendSlowBackgroundMessage(
      page,
      `Slow background reload ${Date.now()}`
    );

    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/chat/${chatId}$`));
    await expect(page.getByTestId("stop-button")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("This is a mocked Pi response")).toBeVisible({
      timeout: 30_000,
    });
  });

  test("continues when the response stream is canceled without stop", async ({
    page,
  }) => {
    await gotoHomeWithProject(page);

    const chatId = await page.evaluate(
      async ({ modelId }) => {
        const id = crypto.randomUUID();
        const response = await fetch("/api/chat", {
          method: "POST",
          body: JSON.stringify({
            id,
            selectedChatModel: modelId,
            message: {
              id: crypto.randomUUID(),
              role: "user",
              parts: [
                { type: "text", text: "Slow background canceled stream" },
              ],
            },
          }),
        });

        if (!response.body) {
          throw new Error("No response body");
        }

        const reader = response.body.getReader();
        await reader.read();
        await reader.cancel();
        return id;
      },
      { modelId: DEFAULT_TEST_MODEL }
    );

    await expect
      .poll(async () => {
        const response = await page.request.get(
          `/api/messages?chatId=${chatId}`
        );
        if (!response.ok()) {
          return "";
        }
        return JSON.stringify(await response.json());
      })
      .toContain("This is a mocked Pi response");

    await page.request.delete(`/api/chat?id=${chatId}`);
  });

  test("stops a background response and allows another message", async ({
    page,
  }) => {
    await gotoHomeWithProject(page);
    const chatId = await sendSlowBackgroundMessage(
      page,
      `Slow background stop ${Date.now()}`
    );

    const stopResponse = page.waitForResponse(
      (response) =>
        response.url().includes(`/api/chat/${chatId}/stop`) &&
        response.request().method() === "POST" &&
        response.status() === 200
    );
    await page.getByTestId("stop-button").click();
    await stopResponse;

    await page.getByTestId("multimodal-input").fill("Hello after stop");
    await page.getByTestId("send-button").click();
    await expect(page.getByText("This is a mocked Pi response")).toBeVisible({
      timeout: 30_000,
    });
  });

  test("clears input after sending", async ({ page }) => {
    await gotoHomeWithProject(page);

    const input = page.getByTestId("multimodal-input");
    await input.fill("Test message");
    await page.getByTestId("send-button").click();

    // Input should be cleared
    await expect(input).toHaveValue("");
  });

  test("shows stop button during generation", async ({ page }) => {
    await page.route("**/api/chat", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.fulfill({
        status: 200,
        contentType: "application/x-ndjson",
        body: `${JSON.stringify({ type: "done" })}\n`,
      });
    });

    await gotoHomeWithProject(page);
    const input = page.getByTestId("multimodal-input");
    await input.fill("Test");
    await page.getByTestId("send-button").click();

    // Stop button should appear during generation
    const stopButton = page.getByTestId("stop-button");
    await expect(stopButton).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Chat Error Handling", () => {
  test("handles API error gracefully", async ({ page }) => {
    await page.route("**/api/chat", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Internal server error" }),
      });
    });

    await gotoHomeWithProject(page);
    const input = page.getByTestId("multimodal-input");
    await input.fill("Test error");
    await page.getByTestId("send-button").click();

    // Should show error toast or message
    await expect(page.getByText(ERROR_TEXT_REGEX).first()).toBeVisible({
      timeout: 5000,
    });
  });
});

test.describe("Suggested Actions", () => {
  test("suggested actions are clickable", async ({ page }) => {
    await gotoHomeWithProject(page);

    const suggestions = page.locator(
      "[data-testid='suggested-actions'] button"
    );
    const count = await suggestions.count();

    if (count > 0) {
      await suggestions.first().click();

      // Should redirect after clicking suggestion
      await expect(page).toHaveURL(CHAT_URL_REGEX, { timeout: 10_000 });
    }
  });
});
