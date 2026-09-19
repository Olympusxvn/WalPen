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
