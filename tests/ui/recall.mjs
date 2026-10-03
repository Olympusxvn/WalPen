// Built UI check with mocked API responses. No credentials, MemWal writes or provider calls.
import { chromium } from "@playwright/test";
import express from "express";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import assert from "node:assert/strict";

const app = express();
app.use(express.static(resolve("dist")));
const server = await new Promise((done) => {
  const listener = app.listen(0, "127.0.0.1", () => done(listener));
});
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    channel: process.env.WALPEN_TEST_BROWSER || "msedge",
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1000 },
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  let fail = false;
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    let data = {};
    let status = 200;
    if (url.pathname === "/api/session")
      data = {
        user: { id: "fixture", username: "judge" },
        services: { walrus: true, llm: true, model: "mock" },
        inviteRequired: false,
      };
    else if (url.pathname === "/api/entries") data = { entries: [] };
    else if (url.pathname === "/api/chat") {
      const request = route.request().postDataJSON();
      if (fail) {
        status = 503;
        data = {
          error:
            request.language === "en"
              ? "We couldn't retrieve memories from Walrus."
              : "Chưa đọc được ký ức từ Walrus.",
        };
      } else
        data = {
          answer: "UI fixture answer",
          sources: [],
          memoryBudget: { truncated: false },
          recall: {
            status: "empty",
            maxDistance: 0.5,
            returnedCount: 3,
            upstreamTotal: 3,
            upstreamDropped: null,
            authorizationRejected: 1,
            invalidDistance: 0,
            relevanceRejected: 2,
            duplicates: 0,
            eligibleCount: 0,
            budgetOmitted: 0,
            usedCount: 0,
            reasons: ["authorization_rejected", "relevance_rejected"],
          },
        };
    }
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });
  await page.goto(origin);
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page
    .getByRole("button", { name: "A little conversation", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("What helps me unwind?");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .getByText(
      "No suitable memory was included in this answer. This does not mean you have no saved memories.",
      { exact: true },
    )
    .waitFor();
  await page
    .getByText(
      "Some results were not relevant enough to this question and were left out.",
      { exact: true },
    )
    .waitFor();
  assert.equal(await page.locator(".source-card").count(), 0);
  mkdirSync("data/recall-ui", { recursive: true });
  await page.screenshot({ path: "data/recall-ui/en.png", fullPage: true });
  await page.getByRole("button", { name: "VI", exact: true }).click();
  await page
    .getByText(
      "Không có ký ức phù hợp được đưa vào câu trả lời này. Điều đó không có nghĩa là bạn chưa lưu ký ức.",
      { exact: true },
    )
    .waitFor();
  await page
    .getByText(
      "Một số kết quả chưa đủ liên quan đến câu hỏi này nên không được dùng.",
      { exact: true },
    )
    .waitFor();
  await page.screenshot({ path: "data/recall-ui/vi.png", fullPage: true });
  fail = true;
  const input = page.locator(".chat-input textarea, .chat-input input");
  await input.fill("Kiểm tra lỗi dịch vụ");
  await input.press("Enter");
  await page
    .getByText("Chưa đọc được ký ức từ Walrus.", { exact: true })
    .waitFor();
  console.log(
    "PASS: EN/VI empty-context notices, no source cards, language switch and retrieval error; API mocked, external requests blocked.",
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
