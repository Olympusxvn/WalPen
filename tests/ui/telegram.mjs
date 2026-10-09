// Built UI check with mocked API responses. No credentials, Telegram, or provider calls.
import { chromium } from "@playwright/test";
import express from "express";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const destination = process.env.VITE_TELEGRAM_BOT_URL || "https://t.me";
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
  let guest = false;
  let linked = false;
  const postedCodes = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    let data = {};
    let status = 200;
    if (url.pathname === "/api/session") {
      if (guest) {
        status = 401;
        data = { error: "Hãy đăng nhập để mở trang nhật ký của bạn." };
      } else
        data = {
          user: { id: "fixture", username: "judge" },
          services: { walrus: true, llm: true, model: "mock" },
          inviteRequired: false,
        };
    } else if (url.pathname === "/api/entries") data = { entries: [] };
    else if (url.pathname === "/api/telegram/status")
      data = linked
        ? {
            linked: true,
            telegramId: "12345",
            linkedAt: "2026-10-09T00:00:00.000Z",
          }
        : { linked: false };
    else if (url.pathname === "/api/telegram/link") {
      const body = route.request().postDataJSON();
      postedCodes.push(body.code);
      if (body.code === "good-code") {
        linked = true;
        data = { linked: true };
      } else {
        status = 400;
        data = { error: "Link code is invalid or expired." };
      }
    }
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });

  async function expectLinks(label) {
    const links = page.getByRole("link", { name: label, exact: true });
    await links.first().waitFor({ timeout: 8000 });
    assert.equal(await links.count(), 2);
    for (const link of await links.all()) {
      assert.equal(await link.getAttribute("href"), destination);
      assert.equal(await link.getAttribute("target"), "_blank");
      const rel = (await link.getAttribute("rel")) || "";
      assert.match(rel, /\bnoreferrer\b/);
      assert.match(rel, /\bnoopener\b/);
    }
  }

  await page.goto(origin);
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expectLinks("Chat via Telegram");
  await page.getByRole("button", { name: "VI", exact: true }).click();
  await expectLinks("Trò chuyện qua Telegram");

  await page.getByRole("button", { name: "EN", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const code = page.getByRole("textbox", { name: "Link code", exact: true });
  await code.waitFor();
  await page
    .getByText(
      "Telegram handles sent messages. The configured AI provider handles chat.",
      { exact: true },
    )
    .waitFor();
  await page.getByRole("button", { name: "VI", exact: true }).click();
  await page.getByRole("textbox", { name: "Mã liên kết", exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Liên kết tài khoản", exact: true })
    .waitFor();
  await page
    .getByText(
      "Telegram xử lý tin nhắn đã gửi. Nhà cung cấp AI đã cấu hình xử lý hội thoại.",
      { exact: true },
    )
    .waitFor();

  await page.getByRole("button", { name: "EN", exact: true }).click();
  await code.fill("x".repeat(200));
  assert.ok((await code.inputValue()).length <= 128);
  assert.equal(
    postedCodes.some((value) => value.length > 128),
    false,
  );
  await page
    .getByText("That link code is too long.", { exact: true })
    .waitFor();

  await code.fill("   ");
  await page.getByRole("button", { name: "Link account", exact: true }).click();
  await page.getByText("Enter a link code.", { exact: true }).waitFor();
  assert.deepEqual(postedCodes, []);

  await code.fill("NOPE");
  await page.getByRole("button", { name: "Link account", exact: true }).click();
  await page
    .getByText("Link code is invalid or expired.", { exact: true })
    .waitFor();
  assert.deepEqual(postedCodes, ["NOPE"]);

  await code.fill("  good-code  ");
  await page.getByRole("button", { name: "Link account", exact: true }).click();
  await page.getByText("Telegram account linked.", { exact: true }).waitFor();
  await page.getByText("12345", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("textbox", { name: "Link code", exact: true }).count(),
    0,
  );
  assert.deepEqual(postedCodes, ["NOPE", "good-code"]);
  const stored = await page.evaluate(
    () => JSON.stringify(localStorage) + JSON.stringify(sessionStorage),
  );
  assert.equal(stored.includes("good-code"), false);
  assert.equal(stored.includes("NOPE"), false);

  await page.getByRole("button", { name: "VI", exact: true }).click();
  await page
    .getByText("Đã liên kết tài khoản Telegram.", { exact: true })
    .waitFor();

  guest = true;
  linked = false;
  await page.goto(origin);
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expectLinks("Chat via Telegram");
  assert.equal(
    await page.getByRole("textbox", { name: "Link code", exact: true }).count(),
    0,
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  assert.equal(
    await page.getByRole("textbox", { name: "Link code", exact: true }).count(),
    0,
  );
  console.log(
    "PASS: EN/VI Telegram links use the configured destination; signed-in Settings links a code; guests do not see the code form.",
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
