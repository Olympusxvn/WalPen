import { useState } from "react";

export type AICredentials = {
  provider: "gemini" | "openai";
  model: string;
  apiKey: string;
};
export function CloudAISettings({
  language,
  value,
  onSave,
}: {
  language: "en" | "vi";
  value: AICredentials | null;
  onSave: (value: AICredentials | null) => void;
}) {
  const en = language === "en";
  const [provider, setProvider] = useState<"gemini" | "openai">(
    value?.provider || "gemini",
  );
  const [model, setModel] = useState(value?.model || "gemini-3.5-flash-lite");
  const [apiKey, setKey] = useState(value?.apiKey || "");
  return (
    <section className="settings-card">
      <h2>{en ? "Your AI connection" : "Kết nối AI của bạn"}</h2>
      <p>
        {en
          ? "Use your Gemini or OpenAI API key. Your key stays in this tab's session and is sent through WalPen's backend only when you chat. It is not saved to the database or Walrus. Messages and approved memories are sent to your chosen AI provider; its usage charges apply."
          : "Dùng khóa API Gemini hoặc OpenAI của bạn. Khóa được giữ trong phiên của tab này và gửi qua backend WalPen khi trò chuyện; không lưu vào database hoặc Walrus. Tin nhắn và ký ức được cho phép sẽ gửi đến dịch vụ AI bạn chọn; phí sử dụng theo nhà cung cấp."}
      </p>
      <form
        className="ai-settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({ provider, model: model.trim(), apiKey: apiKey.trim() });
        }}
      >
        <label>
          {en ? "Provider" : "Dịch vụ"}
          <select
            value={provider}
            onChange={(event) => {
              const next = event.target.value as "gemini" | "openai";
              setProvider(next);
              setModel(
                next === "gemini" ? "gemini-3.5-flash-lite" : "gpt-4.1-mini",
              );
              setKey("");
            }}
          >
            <option value="gemini">Gemini</option>
            <option value="openai">OpenAI</option>
          </select>
        </label>
        <label>
          Model
          <input
            required
            value={model}
            maxLength={100}
            pattern="[a-zA-Z0-9_.:\-]+"
            onChange={(event) => setModel(event.target.value)}
          />
        </label>
        <label>
          API key
          <input
            type="password"
            required
            minLength={10}
            maxLength={512}
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={(event) => setKey(event.target.value)}
          />
        </label>
        <div className="button-row">
          <button className="primary" type="submit">
            {en ? "Use this key" : "Dùng khóa này"}
          </button>
          <button
            className="secondary"
            type="button"
            onClick={() => {
              setKey("");
              onSave(null);
            }}
          >
            {en ? "Remove key" : "Xóa khóa"}
          </button>
        </div>
      </form>
      <p className="small">
        {value
          ? en
            ? "Key configured. Send a message to check the connection."
            : "Đã cấu hình khóa. Gửi tin nhắn để kiểm tra kết nối."
          : en
            ? "No personal key configured."
            : "Chưa cấu hình khóa riêng."}
      </p>
      <a
        href={
          provider === "gemini"
            ? "https://aistudio.google.com/apikey"
            : "https://platform.openai.com/api-keys"
        }
        target="_blank"
        rel="noreferrer"
      >
        {en
          ? "Get an API key from the provider"
          : "Lấy khóa API từ nhà cung cấp"}
      </a>
    </section>
  );
}
