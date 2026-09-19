import { useEffect, useState } from "react";
import { translate } from "./translations";
export type Language = "vi" | "en";
let current: Language = "vi";
try {
  current = localStorage.getItem("walpen-language") === "en" ? "en" : "vi";
} catch {}
export function t(value: string) {
  return translate(value, current);
}
export function getLocale() {
  return current === "en" ? "en-GB" : "vi-VN";
}
export function useLanguage() {
  const [language, update] = useState<Language>(current);
  function setLanguage(next: Language) {
    current = next;
    update(next);
    try {
      localStorage.setItem("walpen-language", next);
    } catch {}
  }
  useEffect(() => {
    document.documentElement.lang = language;
    document.title =
      language === "en"
        ? "WalPen — A little room for yourself"
        : "WalPen — Một khoảng lặng cho riêng mình";
  }, [language]);
  return [language, setLanguage] as const;
}
