import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { english, translate } from "../src/translations.ts";
test("every Vietnamese UI translation key has an English translation", () => {
  const file = ts.createSourceFile(
    "App.tsx",
    readFileSync("src/App.tsx", "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const missing: string[] = [];
  const walk = (n: ts.Node) => {
    if (
      ts.isCallExpression(n) &&
      n.expression.getText(file) === "t" &&
      n.arguments[0] &&
      ts.isStringLiteral(n.arguments[0])
    ) {
      const key = n.arguments[0].text.trim();
      if (/[À-ỹ]/.test(key) && !english[key]) missing.push(key);
    }
    ts.forEachChild(n, walk);
  };
  walk(file);
  assert.deepEqual(missing, []);
});
test("telegram actions and linking messages have English translations", () => {
  assert.equal(translate("Trò chuyện qua Telegram", "en"), "Chat via Telegram");
  assert.equal(
    translate(
      "Telegram xử lý tin nhắn đã gửi. Nhà cung cấp AI đã cấu hình xử lý hội thoại.",
      "en",
    ),
    "Telegram handles sent messages. The configured AI provider handles chat.",
  );
  assert.equal(translate("Mã liên kết", "en"), "Link code");
  assert.equal(translate("Liên kết tài khoản", "en"), "Link account");
  assert.equal(translate("Hãy nhập mã liên kết.", "en"), "Enter a link code.");
  assert.equal(
    translate("Mã liên kết quá dài.", "en"),
    "That link code is too long.",
  );
  assert.equal(
    translate("Mã liên kết không hợp lệ hoặc đã hết hạn.", "en"),
    "Link code is invalid or expired.",
  );
  assert.equal(
    translate("Đã liên kết tài khoản Telegram.", "en"),
    "Telegram account linked.",
  );
  assert.equal(translate("Đã liên kết Telegram.", "en"), "Telegram is linked.");
});
test("translation preserves user content and whitespace and supports Vietnamese branding", () => {
  assert.equal(translate("  Trang nhật ký ", "en"), "  Journal ");
  assert.equal(translate("My own diary content", "vi"), "My own diary content");
  assert.equal(
    translate("Nhật ký do tôi viết riêng", "en"),
    "Nhật ký do tôi viết riêng",
  );
  assert.equal(
    translate("A LITTLE ROOM FOR YOURSELF", "vi"),
    "MỘT KHOẢNG LẶNG CHO RIÊNG MÌNH",
  );
});
