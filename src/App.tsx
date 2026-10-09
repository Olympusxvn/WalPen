import { t, getLocale, useLanguage } from "./i18n";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CloudAISettings, type AICredentials } from "./CloudAISettings";
import { WalletLogin } from "./WalletLogin";
import { recallNotices, type RecallDiagnostics } from "../shared/recall";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronRight,
  Cloud,
  Feather,
  Leaf,
  LoaderCircle,
  LogOut,
  MessageCircle,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Sprout,
  Waves,
  Workflow,
  X,
} from "lucide-react";
type Page = "journal" | "write" | "talk" | "memories" | "settings" | "how";
type Entry = {
  id: string;
  rootId: string;
  revision: number;
  title: string;
  body: string;
  memory: string;
  mood: string;
  consent: boolean;
  occurredAt: string;
  createdAt: string;
  status: string;
  error: string | null;
  blobId: string | null;
};
type User = { id: string; username: string; walletAddress?: string };
type Source = {
  id: string;
  title: string;
  text: string;
  date: string;
  blobId: string;
};
type Message = {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  memoryBudget?: { truncated: boolean };
  recall?: RecallDiagnostics;
};
const nav = [
  { id: "journal", label: "Trang nhật ký", icon: BookOpen },
  { id: "talk", label: "Một cuộc trò chuyện", icon: MessageCircle },
  { id: "memories", label: "Điều được nhớ", icon: Sprout },
  { id: "how", label: "Cách hoạt động", icon: Workflow },
] as const;
declare global {
  interface ImportMetaEnv {
    readonly VITE_TELEGRAM_BOT_URL?: string;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}
const moods = [
  { icon: "🌿", label: "Bình yên" },
  { icon: "☀️", label: "Vui vẻ" },
  { icon: "☁️", label: "Lưng chừng" },
  { icon: "🌧️", label: "Trầm lắng" },
  { icon: "✨", label: "Biết ơn" },
];
async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const r = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r
    .json()
    .catch(() => ({ error: t("Kết nối đang gián đoạn. Thử lại nhé.") }));
  if (!r.ok) throw new Error(data.error || t("Không thể thực hiện yêu cầu."));
  return data;
}
const date = (s: string) =>
  new Date(s).toLocaleDateString(getLocale(), {
    day: "numeric",
    month: "long",
  });
function Status({ entry }: { entry: Entry }) {
  return (
    <span className={"status " + entry.status}>
      {entry.status === "synced" ? (
        <>
          <CheckCheck size={13} /> {t(" Đã lưu trên Walrus")}
        </>
      ) : entry.status === "failed" ? (
        <>
          <Cloud size={13} /> {t("Lưu thất bại")}
        </>
      ) : entry.status === "uncertain" ? (
        <>
          <Cloud size={13} /> {t(" Cần đối soát")}
        </>
      ) : (
        <>
          <Cloud size={13} /> {t(" Chờ Walrus xác nhận")}
        </>
      )}
    </span>
  );
}
function TelegramChatLink() {
  return (
    <a
      className="text-button telegram-link"
      href={import.meta.env.VITE_TELEGRAM_BOT_URL || "https://t.me"}
      target="_blank"
      rel="noreferrer noopener"
    >
      {t("Trò chuyện qua Telegram")}
    </a>
  );
}
function Botanical() {
  return (
    <svg
      className="botanical"
      viewBox="0 0 300 360"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M112 335C172 263 100 201 188 98M141 269C197 239 215 210 231 169M142 232C106 193 81 167 65 123"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M164 158C163 108 183 70 223 49C229 100 211 134 164 158ZM154 207C181 158 211 145 249 149C237 192 204 215 154 207ZM140 257C164 218 193 217 225 222C202 254 175 269 140 257ZM130 222C90 213 67 187 65 151C111 158 132 180 130 222ZM148 173C112 161 99 138 102 103C135 116 153 138 148 173Z"
        fill="currentColor"
        fillOpacity=".1"
        stroke="currentColor"
        strokeWidth="1.1"
      />
      <path
        d="M181 126L210 71M178 190L232 160M91 178L118 209"
        stroke="currentColor"
        strokeOpacity=".4"
      />
      <circle cx="65" cy="77" r="3" fill="currentColor" fillOpacity=".25" />
      <circle cx="242" cy="271" r="2" fill="currentColor" fillOpacity=".3" />
      <path d="M251 88v12m-6-6h12" stroke="currentColor" strokeOpacity=".4" />
    </svg>
  );
}
export default function App() {
  const walletAccount = useCurrentAccount(),
    walletKit = useDAppKit();
  const previousWallet = useRef<string | null>(null);
  const [legacyLogin, setLegacyLogin] = useState(false);
  const [language, setLanguage] = useLanguage();
  const [aiCredentials, setAiCredentials] = useState<AICredentials | null>(
    null,
  );
  const [page, setPage] = useState<Page>("journal"),
    [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false),
    [entries, setEntries] = useState<Entry[]>([]),
    [services, setServices] = useState({
      walrus: false,
      llm: false,
      model: "",
    }),
    [auth, setAuth] = useState(false),
    [register, setRegister] = useState(true),
    [inviteRequired, setInviteRequired] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<Entry | null>(null);
  const [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [mood, setMood] = useState("🌿"),
    [consent, setConsent] = useState(false),
    [memory, setMemory] = useState(""),
    [editing, setEditing] = useState<Entry | null>(null),
    [draftRestored, setDraftRestored] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]),
    [input, setInput] = useState(""),
    [thinking, setThinking] = useState(false),
    [useMemory, setUseMemory] = useState(true);
  const [telegramStatus, setTelegramStatus] = useState<{
      linked: boolean;
      telegramId?: string;
    } | null>(null),
    [telegramCode, setTelegramCode] = useState(""),
    [telegramError, setTelegramError] = useState<
      "" | "empty" | "long" | "invalid" | "request"
    >(""),
    [telegramJustLinked, setTelegramJustLinked] = useState(false);
  const telegramTooLong = useRef(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const address = walletAccount?.address.toLowerCase() || null;
    if (
      user?.walletAddress &&
      ((address && address !== user.walletAddress) ||
        (previousWallet.current && !address))
    ) {
      saveAI(null);
      setUser(null);
      setEntries([]);
      setMessages([]);
      setSelected(null);
      setAuth(true);
      void api("/logout", {}).catch(() => {});
    }
    previousWallet.current = address;
  }, [walletAccount?.address, user?.walletAddress]);
  useEffect(() => {
    setAiCredentials(null);
    if (!user) return;
    try {
      const saved = JSON.parse(
        sessionStorage.getItem("walpen-ai-" + user.id) || "null",
      );
      if (
        saved &&
        ["gemini", "openai"].includes(saved.provider) &&
        typeof saved.apiKey === "string" &&
        typeof saved.model === "string"
      )
        setAiCredentials(saved);
    } catch {}
  }, [user?.id]);
  function saveAI(value: AICredentials | null) {
    setAiCredentials(value);
    setMessages([]);
    if (!user) return;
    try {
      if (value)
        sessionStorage.setItem("walpen-ai-" + user.id, JSON.stringify(value));
      else sessionStorage.removeItem("walpen-ai-" + user.id);
    } catch {}
  }
  useEffect(() => {
    if (!user) {
      telegramTooLong.current = false;
      setTelegramStatus(null);
      setTelegramCode("");
      setTelegramError("");
      setTelegramJustLinked(false);
      return;
    }
    if (page !== "settings") return;
    let active = true;
    api("/telegram/status")
      .then((status) => {
        if (!active) return;
        setTelegramStatus((current) => (current?.linked ? current : status));
      })
      .catch(() => {
        if (active) setTelegramError("request");
      });
    return () => {
      active = false;
    };
  }, [user?.id, page]);
  useEffect(() => {
    api("/session")
      .then((d) => {
        setUser(d.user);
        setServices(d.services);
        setInviteRequired(d.inviteRequired);
      })
      .catch((e) => setError(e.message))
      .finally(() => setReady(true));
  }, []);
  const refresh = async () => {
    if (user) {
      const d = await api("/entries");
      setEntries(d.entries);
    }
  };
  useEffect(() => {
    if (!user) return;
    let active = true;
    const load = () =>
      api("/entries")
        .then((d) => {
          if (active) setEntries(d.entries);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    void load();
    const timer = setInterval(load, 12000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [user?.id]);
  useEffect(() => {
    if (!notice) return;
    const timeoutId = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timeoutId);
  }, [notice]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, thinking]);
  useEffect(() => {
    if (!user || page !== "write" || !draftRestored) return;
    const timeoutId = setTimeout(() => {
      try {
        localStorage.setItem(
          "walpen-draft-" + user.id,
          JSON.stringify({
            title,
            body,
            mood,
            consent,
            memory,
            editingId: editing?.id,
          }),
        );
      } catch {
        setError(
          t("Bộ nhớ trình duyệt đã đầy. Bản nháp chưa được lưu trên thiết bị."),
        );
      }
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [
    title,
    body,
    mood,
    consent,
    memory,
    page,
    draftRestored,
    user?.id,
    editing?.id,
  ]);
  function go(p: Page) {
    setError("");
    setSelected(null);
    if (!user && p !== "journal" && p !== "how") {
      setAuth(true);
      return;
    }
    setPage(p);
    if (p === "write") openWrite();
  }
  function openWrite(e?: Entry) {
    if (!user) {
      setAuth(true);
      return;
    }
    setPage("write");
    setSelected(null);
    setEditing(e || null);
    setDraftRestored(false);
    let draft: any = null;
    try {
      draft = JSON.parse(
        localStorage.getItem("walpen-draft-" + user.id) || "null",
      );
    } catch {}
    const v = e || draft;
    setTitle(v?.title || "");
    setBody(v?.body || "");
    setMood(v?.mood || "🌿");
    setConsent(v?.consent || false);
    setMemory(v?.memory || "");
    if (!e && draft?.editingId)
      setEditing(entries.find((x) => x.id === draft.editingId) || null);
    setDraftRestored(true);
  }
  async function save() {
    if (!body.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api("/entries", {
        title,
        body,
        mood,
        consent,
        memory: consent ? memory : "",
        occurredAt: editing?.occurredAt || new Date().toISOString(),
        supersedes: editing?.id || null,
      });
      localStorage.removeItem("walpen-draft-" + user!.id);
      setDraftRestored(false);
      setPage("journal");
      setEditing(null);
      await refresh();
      setNotice(t("Trang của bạn đã được giữ lại. Đang gửi tới Walrus."));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function linkTelegram(event: FormEvent) {
    event.preventDefault();
    const code = telegramCode.trim();
    if (telegramTooLong.current || code.length > 128) {
      telegramTooLong.current = true;
      setTelegramError("long");
      setTelegramJustLinked(false);
      return;
    }
    if (!code) {
      setTelegramError("empty");
      setTelegramJustLinked(false);
      return;
    }
    setTelegramError("");
    try {
      await api("/telegram/link", { code });
      setTelegramCode("");
      setTelegramJustLinked(true);
      setTelegramStatus(await api("/telegram/status"));
    } catch (e: any) {
      setTelegramJustLinked(false);
      setTelegramError(
        e?.message === "Link code is invalid or expired." ? "invalid" : "request",
      );
    }
  }
  function onTelegramCode(value: string) {
    if (value.length > 128) {
      telegramTooLong.current = true;
      setTelegramCode(value.slice(0, 128));
      setTelegramError("long");
      return;
    }
    telegramTooLong.current = false;
    setTelegramCode(value);
    setTelegramError("");
  }
  async function send(text = input) {
    if (!text.trim() || thinking) return;
    if (!user) {
      setAuth(true);
      return;
    }
    if (!aiCredentials && !services.llm) {
      setPage("settings");
      setError(t("Thêm khóa AI trong Cài đặt để bắt đầu trò chuyện."));
      return;
    }
    setInput("");
    setError("");
    setThinking(true);
    const previous = messages;
    setMessages((m) => [...m, { role: "user", content: text }]);
    try {
      const r = await api("/chat", {
        message: text,
        history: previous
          .slice(-8)
          .map(({ role, content }) => ({ role, content })),
        useMemory,
        language,
        llm: aiCredentials || undefined,
      });
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: r.answer,
          sources: r.sources,
          memoryBudget: r.memoryBudget,
          recall: r.recall,
        },
      ]);
    } catch (e: any) {
      setError(e.message);
      setInput(text);
      setMessages(previous);
    } finally {
      setThinking(false);
    }
  }
  async function forget(e: Entry) {
    setBusy(true);
    try {
      await api(`/entries/${e.id}/forget`, {});
      setSelected(null);
      setMessages([]);
      await refresh();
      setNotice(
        t("WalPen sẽ không dùng ký ức này trong cuộc trò chuyện tiếp theo."),
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const visible = entries.filter((e) =>
    (e.title + " " + e.body).toLowerCase().includes(search.toLowerCase()),
  );
  const memories = entries.filter((e) => e.consent);
  const pageTitle =
    page === "journal"
      ? t("Nhật ký của bạn")
      : page === "write"
        ? t("Một trang mới")
        : page === "talk"
          ? t("Trò chuyện cùng WalPen")
          : page === "memories"
            ? t("Những điều được giữ lại")
            : page === "how"
              ? t("How it works")
            : t("Không gian của bạn");
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            go("journal");
          }}
        >
          <span className="brand-mark">
            <Feather size={23} />
          </span>
          WalPen<span className="brand-dot">.</span>
        </a>
        <p className="brand-caption">{t("A LITTLE ROOM FOR YOURSELF")}</p>
        <button className="write-button" onClick={() => openWrite()}>
          <Plus size={18} /> {t(" Viết một chút ")}
          <span>↗</span>
        </button>
        <div className="nav-label">{t("KHÔNG GIAN CỦA BẠN")}</div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={page === n.id ? "nav-item active" : "nav-item"}
              onClick={() => go(n.id)}
            >
              <n.icon size={19} />
              {t(n.label)}
              {page === n.id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span>“</span>
          <p>
            {t("Không cần một ngày đặc biệt")}
            <br />
            {t("để viết một điều đáng nhớ.")}
          </p>
          <div className="tiny-line" />
        </div>
        <div className="sidebar-bottom">
          <button
            className={"nav-item " + (page === "settings" ? "active" : "")}
            onClick={() => go("settings")}
          >
            <Settings size={18} /> {t(" Cài đặt")}
          </button>
          <div className="user-row">
            <div className="avatar">
              {user ? user.username[0].toUpperCase() : <Leaf size={18} />}
            </div>
            <button
              className="user-info"
              onClick={() => (user ? go("settings") : setAuth(true))}
            >
              <strong>
                {user?.walletAddress
                  ? `${user.walletAddress.slice(0, 6)}…${user.walletAddress.slice(-4)}`
                  : user?.username || t("Chào người bạn mới")}
              </strong>
              <small>
                {user
                  ? t("Một khoảng lặng của riêng bạn")
                  : t("Bắt đầu trang đầu tiên")}
              </small>
            </button>
            {user && (
              <button
                aria-label={t("Đăng xuất")}
                className="icon-button"
                onClick={async () => {
                  try {
                    await api("/logout", {});
                    await walletKit.disconnectWallet();
                    saveAI(null);
                    setUser(null);
                    setEntries([]);
                    setMessages([]);
                    setBody("");
                    setMemory("");
                    setSelected(null);
                    setDraftRestored(false);
                    setPage("journal");
                  } catch (e: any) {
                    setError(e.message);
                  }
                }}
              >
                <LogOut size={16} />
              </button>
            )}
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <span className="breadcrumb">{t("Không gian riêng")}</span>
            <ChevronRight size={13} />
            <span>{pageTitle}</span>
          </div>
          <span className="top-note">
            <span className="green-dot" />{" "}
            {t(" Chậm một chút, cũng không sao.")}
          </span>
          <a
            className="mobile-brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              go("journal");
            }}
          >
            WalPen.
          </a>
          <div
            className="language-switch"
            role="group"
            aria-label="Language / Ngôn ngữ"
          >
            <button
              type="button"
              aria-pressed={language === "vi"}
              onClick={() => setLanguage("vi")}
            >
              VI
            </button>
            <span>/</span>
            <button
              type="button"
              aria-pressed={language === "en"}
              onClick={() => setLanguage("en")}
            >
              EN
            </button>
          </div>
          <TelegramChatLink />
          <button
            className="mobile-account icon-button"
            aria-label={t("Tài khoản")}
            onClick={() => (user ? go("settings") : setAuth(true))}
          >
            <Settings size={19} />
          </button>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            {t(error)}
            <button
              className="icon-button"
              aria-label={t("Đóng thông báo")}
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {!ready ? (
          <div className="loading">
            <LoaderCircle className="spin" />{" "}
            {t(" Đang mở không gian của bạn…")}
          </div>
        ) : (
          <>
            {page === "journal" && (
              <div className="page journal-page">
                <div className="date-line">
                  <span className="mini-sun">☼</span>
                  {new Date().toLocaleDateString(getLocale(), {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </div>
                <section className="hero">
                  <div className="hero-copy">
                    <div className="eyebrow">
                      {t("MỘT TRANG GIẤY. MỘT KHOẢNG LẶNG.")}
                    </div>
                    <h1>
                      {t("Hôm nay của bạn,")}
                      <br />
                      <em>{t("có điều gì ở lại?")}</em>
                    </h1>
                    <p>
                      {t("Một ý nghĩ thoáng qua. Một niềm vui nho nhỏ.")}
                      <br />
                      {t("Hay chỉ vài dòng để nhẹ lòng hơn.")}
                    </p>
                    <button className="primary" onClick={() => openWrite()}>
                      <Feather size={17} /> {t(" Mở một trang mới ")}
                      <ArrowRight size={16} />
                    </button>
                    <span className="hero-footnote">
                      {t("Không cần viết hay. Chỉ cần là bạn.")}
                    </span>
                  </div>
                  <div className="hero-art">
                    <div className="art-orbit" />
                    <Botanical />
                    <div className="paper-note">
                      <span className="paper-tape" />
                      <span className="paper-date">
                        {t("a note to myself")}
                      </span>
                      <p>
                        {t("Cứ từ từ thôi.")}
                        <br />
                        {t("Mình đang ở đây.")}
                      </p>
                      <span className="paper-line" />
                      <Leaf size={18} />
                    </div>
                    <span className="art-caption">
                      {t("small moments, softly kept.")}
                    </span>
                  </div>
                </section>
                <div className="journal-columns">
                  <section className="entries-section">
                    <div className="section-heading">
                      <div>
                        <h2>
                          {t("Những trang gần đây ")}
                          <span className="subtle-flower">✳</span>
                        </h2>
                        <p>
                          {t("Mỗi ngày một chút, thành câu chuyện của bạn.")}
                        </p>
                      </div>
                      {entries.length > 0 && (
                        <span className="quiet-label">
                          {entries.length}{" "}
                          {language === "en" && entries.length === 1
                            ? "page"
                            : t("trang")}
                        </span>
                      )}
                    </div>
                    {entries.length > 0 && (
                      <label className="search">
                        <Search size={17} />
                        <input
                          aria-label={t("Tìm trang nhật ký")}
                          placeholder={t("Tìm một ngày, một điều đã viết…")}
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                      </label>
                    )}
                    <div className="entry-list">
                      {visible.slice(0, 12).map((e) => (
                        <button
                          className="entry-card"
                          key={e.id}
                          onClick={() => setSelected(e)}
                        >
                          <span className="entry-mood">{e.mood}</span>
                          <div>
                            <span className="entry-date">
                              {date(e.occurredAt)} <span>·</span>{" "}
                              {new Date(e.occurredAt).getFullYear()}
                            </span>
                            <h3>{e.title || t("Một ngày, vài dòng")}</h3>
                            <p>{e.body}</p>
                            <Status entry={e} />
                          </div>
                          <ArrowRight size={17} className="entry-arrow" />
                        </button>
                      ))}
                      {!visible.length && (
                        <div className="empty-journal">
                          <div className="empty-pages">
                            <BookOpen size={29} />
                            <span>✧</span>
                          </div>
                          <h3>
                            {search
                              ? t("Chưa tìm thấy trang này")
                              : t("Câu chuyện bắt đầu từ một dòng.")}
                          </h3>
                          <p>
                            {search
                              ? t("Thử một từ khác nhé.")
                              : t(
                                  "Trang đầu tiên vẫn đang đợi. Không vội đâu.",
                                )}
                          </p>
                          <button
                            className="text-button"
                            onClick={() =>
                              search ? setSearch("") : openWrite()
                            }
                          >
                            {search
                              ? t("Xem tất cả")
                              : t("Viết trang đầu tiên")}{" "}
                            <ArrowRight size={15} />
                          </button>
                        </div>
                      )}
                    </div>
                  </section>
                  <aside className="reflection-column">
                    <div className="prompt-card">
                      <div className="card-label">
                        <Sparkles size={15} /> {t(" MỘT GỢI MỞ NHỎ")}
                      </div>
                      <p>
                        {t("Điều gì thật bình thường")}
                        <br />
                        {t("hôm nay, nhưng bạn")}
                        <br />
                        <em>{t("muốn giữ lại?")}</em>
                      </p>
                      <span>
                        {t("Không có câu trả lời đúng.")}
                        <br />
                        {t("Chỉ có câu trả lời của bạn.")}
                      </span>
                      <button
                        className="text-button"
                        onClick={() => {
                          openWrite();
                        }}
                      >
                        {t("Để mình nghĩ một chút ")}
                        <ArrowRight size={15} />
                      </button>
                    </div>
                    <div className="companion-card">
                      <div className="companion-icon">
                        <Waves size={24} />
                      </div>
                      <h3>{t("Một người bạn biết lắng nghe.")}</h3>
                      <p>
                        {t(
                          "WalPen có thể nhớ những điều bạn cho phép, để lần sau mình không phải bắt đầu lại.",
                        )}
                      </p>
                      <div className="companion-actions">
                        <button
                          className="text-button"
                          onClick={() => go("talk")}
                        >
                          {t("Ngồi xuống, trò chuyện ")}
                          <ArrowRight size={15} />
                        </button>
                        <TelegramChatLink />
                      </div>
                    </div>
                    <div className="privacy-note">
                      <ShieldCheck size={17} />
                      <p>
                        {t("Bạn chọn điều được nhớ.")}
                        <br />
                        <a
                          href="#"
                          onClick={(e) => {
                            e.preventDefault();
                            go("settings");
                          }}
                        >
                          {t("Tìm hiểu về quyền riêng tư ")}
                          <ChevronRight size={11} />
                        </a>
                      </p>
                    </div>
                  </aside>
                </div>
                <footer className="page-footer">
                  <span>
                    <Leaf size={13} /> {t(" Made for your quieter moments.")}
                  </span>
                  <span>
                    {t("Memory, held with Walrus ")}
                    <Waves size={15} />
                  </span>
                </footer>
              </div>
            )}
            {page === "how" && (
              <div className="page how-page">
                <div className="eyebrow">{t("WALPEN · WALRUS MEMORY")}</div>
                <h1>{t("How it works")}</h1>
                <p className="how-intro">
                  {t(
                    "A private journal that can carry the memories you choose into future conversations.",
                  )}
                </p>
                <div className="how-steps">
                  <section className="how-card">
                    <span className="how-number">01</span>
                    <h2>{t("Connect your Sui wallet")}</h2>
                    <p>
                      {t(
                        "Choose a wallet such as Slush or any other Sui wallet, then approve a personal sign-in message. No transaction or gas fee is needed.",
                      )}
                    </p>
                  </section>
                  <section className="how-card">
                    <span className="how-number">02</span>
                    <h2>{t("Write and choose what to remember")}</h2>
                    <p>
                      {t(
                        "Write a journal entry and explicitly approve the memory excerpt you want WalPen to use. The memory is sent through Walrus Memory and persisted on Walrus Mainnet. Neon keeps supporting job state and cache metadata.",
                      )}
                    </p>
                  </section>
                  <section className="how-card">
                    <span className="how-number">03</span>
                    <h2>{t("Return and pick up where you left off")}</h2>
                    <p>
                      {t(
                        "In a later conversation, Walrus Memory recalls relevant approved excerpts for the AI. You can stop using a memory at any time; this excludes it from future replies.",
                      )}
                    </p>
                  </section>
                </div>
                <div className="how-note">
                  <ShieldCheck size={20} />
                  <p>
                    {t(
                      "Your journal is stored on Walrus. Neon supports the app with job and cache records; it is not the sole store for conversational memory.",
                    )}
                  </p>
                </div>
                <button
                  className="primary how-cta"
                  onClick={() => go("journal")}
                >
                  {t("Back to journal")} <ArrowRight size={16} />
                </button>
              </div>
            )}
            {page === "write" && (
              <div className="page">
                <button
                  className="text-button back"
                  onClick={() => go("journal")}
                >
                  <ArrowLeft size={16} /> {t(" Về nhật ký")}
                </button>
                <div className="editor-heading">
                  <div className="eyebrow">
                    {t("DÀNH MỘT CHÚT THỜI GIAN CHO MÌNH")}
                  </div>
                  <h1>
                    {editing
                      ? t("Trở lại một trang cũ.")
                      : t("Cứ viết, như bạn là.")}
                  </h1>
                  <p>{t("Không cần sửa mình cho vừa một trang giấy.")}</p>
                </div>
                <div className="editor-layout">
                  <div className="writing-paper">
                    <input
                      className="title-input"
                      aria-label={t("Tiêu đề")}
                      maxLength={120}
                      placeholder={t("Đặt tên cho ngày hôm nay…")}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                    <div className="writing-date">
                      {date(editing?.occurredAt || new Date().toISOString())}
                      <span>
                        {" "}
                        {body.trim() ? body.trim().split(/\s+/).length : 0}{" "}
                        {t(" từ")}
                      </span>
                    </div>
                    <textarea
                      className="body-input"
                      aria-label={t("Nội dung nhật ký")}
                      maxLength={12000}
                      placeholder={t("Hôm nay, mình…")}
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                    />
                    <div className="draft-note">
                      <Check size={13} />{" "}
                      {t(" Bản nháp giữ trên thiết bị này khi bạn viết.")}
                    </div>
                    <div className="mood-bar">
                      <span>{t("Hôm nay mình thấy")}</span>
                      {moods.map((m) => (
                        <button
                          key={m.icon}
                          className={mood === m.icon ? "mood selected" : "mood"}
                          aria-label={t(m.label)}
                          title={t(m.label)}
                          onClick={() => setMood(m.icon)}
                        >
                          {m.icon}
                        </button>
                      ))}
                    </div>
                  </div>
                  <aside className="save-panel">
                    <Sprout size={28} />
                    <h2>{t("Một điều để nhớ?")}</h2>
                    <p>
                      {t(
                        "Nhật ký sẽ được lưu qua Walrus. Bạn quyết định phần nào WalPen được dùng khi trò chuyện.",
                      )}
                    </p>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                      />{" "}
                      {t(" Cho phép nhớ một điều từ trang này")}
                    </label>
                    {consent && (
                      <>
                        <label className="field-label" htmlFor="memory">
                          {t("Viết chính xác điều bạn muốn nhớ")}
                        </label>
                        <textarea
                          id="memory"
                          className="memory-input"
                          maxLength={2000}
                          placeholder={t(
                            "Ví dụ: Đi bộ ven sông giúp mình bình tĩnh.",
                          )}
                          value={memory}
                          onChange={(e) => setMemory(e.target.value)}
                        />
                        <span className="muted small">
                          {t(
                            "Bạn có thể ngừng sử dụng ký ức này bất cứ lúc nào.",
                          )}
                        </span>
                      </>
                    )}
                    <div className="save-divider" />
                    <p className="small">
                      {t(
                        "Nội dung đi qua backend và relayer trước khi được mã hóa trên Walrus. Dịch vụ AI được chọn trong Cài đặt xử lý hội thoại.",
                      )}
                    </p>
                    <button
                      className="primary full"
                      disabled={
                        busy || !body.trim() || (consent && !memory.trim())
                      }
                      onClick={save}
                    >
                      {busy ? (
                        <LoaderCircle className="spin" size={17} />
                      ) : (
                        <Cloud size={17} />
                      )}{" "}
                      {t(" Lưu trang của mình")}
                    </button>
                    <span className="muted small">
                      {t("Chỉ hiện “Đã lưu trên Walrus” khi nhận xác nhận.")}
                    </span>
                  </aside>
                </div>
              </div>
            )}
            {page === "talk" && (
              <div className="page talk-page">
                <div className="section-heading">
                  <div>
                    <div className="eyebrow">{t("CÓ MỘT NGƯỜI BẠN Ở ĐÂY")}</div>
                    <h1>{t("Mình nghe bạn.")}</h1>
                  </div>
                  <button
                    className="secondary"
                    onClick={() => {
                      setMessages([]);
                      setError("");
                    }}
                    disabled={thinking}
                  >
                    <Plus size={15} /> {t(" Cuộc trò chuyện mới")}
                  </button>
                </div>
                <div className="chat-options">
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={useMemory}
                      onChange={(e) => {
                        setUseMemory(e.target.checked);
                        setMessages([]);
                      }}
                      disabled={thinking}
                    />{" "}
                    {t(" Dùng ký ức được cho phép")}
                  </label>
                  <span>
                    <span className="green-dot" />{" "}
                    {aiCredentials?.model ||
                      (services.llm
                        ? services.model
                        : t("Chưa cấu hình model"))}
                  </span>
                </div>
                <div className="chat-surface">
                  {!messages.length && (
                    <div className="chat-welcome">
                      <div className="large-companion">
                        <Waves size={36} />
                      </div>
                      <h2>{t("Không cần biết bắt đầu từ đâu.")}</h2>
                      <p>
                        {t("Kể mình nghe một chút về ngày của bạn.")}
                        <br />
                        {t("Mình sẽ chỉ nhớ những gì bạn đã chọn lưu.")}
                      </p>
                      <div className="prompt-chips">
                        {[
                          t("Hôm nay mình muốn chậm lại một chút."),
                          t("Bạn nhớ điều gì giúp mình bình tĩnh?"),
                          t("Gợi ý một câu hỏi để mình viết nhé."),
                        ].map((t) => (
                          <button key={t} onClick={() => void send(t)}>
                            {t}
                            <ArrowUpRight />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {messages.map((m, i) => (
                    <div className={"message " + m.role} key={i}>
                      <div className="message-avatar">
                        {m.role === "assistant" ? (
                          <Waves size={18} />
                        ) : (
                          user?.username[0].toUpperCase()
                        )}
                      </div>
                      <div className="message-content">
                        <span className="message-name">
                          {m.role === "assistant" ? "WalPen" : t("Bạn")}
                        </span>
                        <p>{m.content}</p>
                        {m.recall &&
                          recallNotices(m.recall, language).map((notice) => (
                            <p className="recall-notice" key={notice}>
                              <small>{notice}</small>
                            </p>
                          ))}
                        {m.memoryBudget?.truncated &&
                          m.recall?.status !== "empty" && (
                            <small>
                              {t(
                                "Một số ký ức không được đưa vào câu trả lời để giữ ngữ cảnh vừa đủ. Nội dung đã lưu vẫn nguyên vẹn.",
                              )}
                            </small>
                          )}
                        {!!m.sources?.length && (
                          <div className="source-list">
                            <span className="card-label">
                              <Sprout size={13} /> {t(" KÝ ỨC ĐÃ ĐƯỢC DÙNG")}
                            </span>
                            {m.sources.map((s, j) => (
                              <button
                                className="source-card"
                                key={s.id}
                                onClick={() =>
                                  setSelected(
                                    entries.find((e) => e.id === s.id) || null,
                                  )
                                }
                              >
                                <span>
                                  [{j + 1}] {s.title} · {date(s.date)}
                                </span>
                                <p>{s.text}</p>
                                <small>Walrus · {s.blobId.slice(0, 14)}…</small>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {thinking && (
                    <div className="thinking">
                      <LoaderCircle className="spin" size={17} />{" "}
                      {t(
                        " WalPen đang lắng nghe và tìm lại những điều liên quan…",
                      )}
                    </div>
                  )}
                  <div ref={chatEnd} />
                </div>
                <form
                  className="chat-input"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                >
                  <textarea
                    aria-label={t("Tin nhắn")}
                    maxLength={2000}
                    rows={2}
                    placeholder={t("Cứ nói điều đang ở trong lòng bạn…")}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <button
                    className="send-button"
                    aria-label={t("Gửi tin nhắn")}
                    disabled={thinking || !input.trim()}
                  >
                    {thinking ? (
                      <LoaderCircle className="spin" size={19} />
                    ) : (
                      <Send size={19} />
                    )}
                  </button>
                </form>
                <p className="chat-disclaimer">
                  {t(
                    "Hội thoại không tự động được lưu thành ký ức. AI có thể hiểu chưa đúng; bạn luôn có thể chỉnh lại.",
                  )}
                </p>
              </div>
            )}
            {page === "memories" && (
              <div className="page">
                <div className="eyebrow">{t("NHỮNG ĐIỀU BẠN CHỌN GIỮ")}</div>
                <h1>
                  {t("Để lần sau,")}
                  <br />
                  <em>{t("mình vẫn nhớ.")}</em>
                </h1>
                <p className="intro">
                  {t(
                    "Chỉ những điều bạn cho phép mới được dùng trong cuộc trò chuyện.",
                  )}
                </p>
                <div className="memory-grid">
                  {memories.map((e) => (
                    <article className="memory-card" key={e.id}>
                      <div className="memory-card-top">
                        <span>{e.mood}</span>
                        <span>{date(e.occurredAt)}</span>
                      </div>
                      <h3>{e.title || t("Một điều nhỏ để nhớ")}</h3>
                      <p>{e.memory}</p>
                      <Status entry={e} />
                      <div className="memory-actions">
                        <button
                          className="text-button"
                          onClick={() => setSelected(e)}
                        >
                          {t("Xem nguồn ")}
                          <ArrowRight size={14} />
                        </button>
                        <button
                          className="quiet-button"
                          onClick={() => void forget(e)}
                          disabled={busy}
                        >
                          {t("Ngừng ghi nhớ")}
                        </button>
                      </div>
                    </article>
                  ))}
                  {!memories.length && (
                    <div className="empty-journal wide">
                      <Sprout size={34} />
                      <h3>{t("Một khu vườn chưa gieo hạt.")}</h3>
                      <p>
                        {t(
                          "Khi viết nhật ký, chọn một điều bạn muốn WalPen nhớ.",
                        )}
                      </p>
                      <button
                        className="text-button"
                        onClick={() => openWrite()}
                      >
                        {t("Viết một chút ")}
                        <ArrowRight size={15} />
                      </button>
                    </div>
                  )}
                </div>
                <div className="info-box">
                  <ShieldCheck size={20} />
                  <p>
                    {t(
                      "“Ngừng ghi nhớ” loại nội dung khỏi những câu trả lời sau. Thao tác này không xóa vật lý các blob đã lưu trên Walrus.",
                    )}
                  </p>
                </div>
              </div>
            )}
            {page === "settings" && (
              <div className="page settings-page">
                <div className="eyebrow">
                  {t("THOẢI MÁI THEO CÁCH CỦA BẠN")}
                </div>
                <h1>{t("Một không gian riêng.")}</h1>
                {user && (
                  <section className="settings-card">
                    {user.walletAddress ? (
                      <>
                        <h2>Sui wallet</h2>
                        <p className="wallet-address">{user.walletAddress}</p>
                      </>
                    ) : (
                      <WalletLogin
                        language={language}
                        inviteRequired={false}
                        link
                        onSuccess={(signedUser) => {
                          setUser(signedUser);
                          setNotice(
                            language === "en"
                              ? "Wallet linked. Your journal and memory namespace are unchanged."
                              : "Đã liên kết ví. Nhật ký và namespace bộ nhớ được giữ nguyên.",
                          );
                        }}
                      />
                    )}
                  </section>
                )}
                {user && (
                  <section className="settings-card">
                    <h2>Telegram</h2>
                    <p>
                      {t(
                        "Telegram xử lý tin nhắn đã gửi. Nhà cung cấp AI đã cấu hình xử lý hội thoại.",
                      )}
                    </p>
                    {telegramStatus?.linked ? (
                      <>
                        <p role="status">
                          {telegramJustLinked
                            ? t("Đã liên kết tài khoản Telegram.")
                            : t("Đã liên kết Telegram.")}
                        </p>
                        {telegramStatus.telegramId && (
                          <p>{telegramStatus.telegramId}</p>
                        )}
                      </>
                    ) : (
                      <form
                        className="telegram-link-form"
                        onSubmit={(event) => void linkTelegram(event)}
                      >
                        <label>
                          {t("Mã liên kết")}
                          <input
                            value={telegramCode}
                            autoComplete="off"
                            spellCheck={false}
                            onChange={(event) =>
                              onTelegramCode(event.target.value)
                            }
                          />
                        </label>
                        {telegramError === "empty" && (
                          <p role="alert">{t("Hãy nhập mã liên kết.")}</p>
                        )}
                        {telegramError === "long" && (
                          <p role="alert">{t("Mã liên kết quá dài.")}</p>
                        )}
                        {telegramError === "invalid" && (
                          <p role="alert">
                            {t("Mã liên kết không hợp lệ hoặc đã hết hạn.")}
                          </p>
                        )}
                        {telegramError === "request" && (
                          <p role="alert">{t("Không thể thực hiện yêu cầu.")}</p>
                        )}
                        <button className="secondary" type="submit">
                          {t("Liên kết tài khoản")}
                        </button>
                      </form>
                    )}
                  </section>
                )}
                <section className="settings-card">
                  <ShieldCheck size={23} />
                  <h2>{t("Bạn biết dữ liệu của mình đi đâu.")}</h2>
                  <p>
                    {t(
                      "Bản nháp giữ trong trình duyệt. Khi lưu, nhật ký đi qua backend và relayer Walrus Memory để tạo embedding và mã hóa. Relayer có thể đọc nội dung trong quá trình xử lý. Ứng dụng giữ một bản cache mã hóa để bạn mở đúng trang và xuất dữ liệu.",
                    )}
                  </p>
                  <p>
                    {t(
                      "Chatbot dùng dịch vụ AI bạn chọn. Chỉ đoạn ký ức được bạn cho phép mới được đưa vào hội thoại. Với API online, tin nhắn và các đoạn đó được gửi đến nhà cung cấp AI.",
                    )}
                  </p>
                </section>
                <CloudAISettings
                  key={user?.id || "guest"}
                  language={language}
                  value={aiCredentials}
                  onSave={saveAI}
                />
                <section className="settings-card">
                  <div className="section-heading">
                    <h2>{t("Kết nối")}</h2>
                    <span className="quiet-label">{t("Chỉ báo cấu hình")}</span>
                  </div>
                  <div className="service-row">
                    <span>
                      <Waves size={18} /> Walrus Mainnet
                    </span>
                    <span className={services.walrus ? "service-ok" : "muted"}>
                      {services.walrus ? t("Đã cấu hình") : t("Chưa cấu hình")}
                    </span>
                  </div>
                  <div className="service-row">
                    <span>
                      <Sparkles size={18} /> AI ·{" "}
                      {aiCredentials?.model ||
                        (services.llm ? services.model : t("chưa chọn model"))}
                    </span>
                    <span
                      className={
                        aiCredentials || services.llm ? "service-ok" : "muted"
                      }
                    >
                      {aiCredentials || services.llm
                        ? t("Đã cấu hình")
                        : t("Chưa cấu hình")}
                    </span>
                  </div>
                  <p className="small muted">
                    {t(
                      "Trạng thái cấu hình chưa xác nhận dịch vụ đang hoạt động. Kết quả lưu và trò chuyện sẽ hiển thị lỗi thực tế nếu kết nối gián đoạn.",
                    )}
                  </p>
                </section>
                <section className="settings-card">
                  <h2>{t("Mang những trang viết theo bạn.")}</h2>
                  <p>
                    {t(
                      "Tải bản sao nhật ký hiện tại. File xuất chứa nội dung rõ; hãy giữ ở nơi riêng tư.",
                    )}
                  </p>
                  <div className="button-row">
                    <a className="secondary" href="/api/export?format=md">
                      <ArrowDownToLine size={16} /> Markdown
                    </a>
                    <a className="secondary" href="/api/export?format=json">
                      <ArrowDownToLine size={16} /> JSON
                    </a>
                  </div>
                </section>
                <section className="settings-card">
                  <h2>{t("Nhẹ nhàng, ngay từ đầu.")}</h2>
                  <p>
                    {t(
                      "WalPen lấy cảm hứng từ Pause & Pen. Không streak. Không bảng điểm. Bạn viết, AI chỉ đồng hành.",
                    )}
                  </p>
                  <span className="muted small">WalPen · Walrus Memory</span>
                </section>
              </div>
            )}
          </>
        )}
      </main>
      <nav className="mobile-nav">
        {nav.map((n) => (
          <button
            key={n.id}
            aria-label={t(n.label)}
            className={page === n.id ? "active" : ""}
            onClick={() => go(n.id)}
          >
            <n.icon size={20} />
            <span>
              {n.id === "journal"
                ? t("Nhật ký")
                : n.id === "talk"
                  ? t("Trò chuyện")
                  : t("Ký ức")}
            </span>
          </button>
        ))}
        <button aria-label={t("Viết nhật ký")} onClick={() => openWrite()}>
          <Plus size={22} />
          <span>{t("Viết")}</span>
        </button>
      </nav>
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {t(notice)}
        </div>
      )}
      {auth && (
        <div className="modal-backdrop" onClick={() => setAuth(false)}>
          <section
            className="modal auth-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close icon-button"
              aria-label={t("Đóng")}
              onClick={() => setAuth(false)}
            >
              <X size={20} />
            </button>
            <div className="large-companion">
              <Feather size={28} />
            </div>
            <div className="eyebrow">{t("CHÀO MỪNG ĐẾN VỚI WALPEN")}</div>
            <h2 id="auth-title">
              {register ? t("Một nơi cho riêng bạn.") : t("Mừng bạn trở lại.")}
            </h2>
            <p>
              {t(
                "Đăng nhập để tìm lại những trang viết và ký ức qua mỗi lần ghé thăm.",
              )}
            </p>
            <WalletLogin
              language={language}
              inviteRequired={inviteRequired}
              onSuccess={(signedUser) => {
                setUser(signedUser);
                setAuth(false);
                setNotice(t("Chào bạn. Trang giấy đã sẵn sàng."));
              }}
            />
            <button
              className="text-button centered"
              onClick={() => {
                setLegacyLogin(!legacyLogin);
                setRegister(false);
              }}
            >
              {language === "en"
                ? "Existing account / password sign-in"
                : "Tài khoản cũ / đăng nhập bằng mật khẩu"}
            </button>
            {legacyLogin && (
              <>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    setError("");
                    const f = new FormData(e.currentTarget);
                    try {
                      const d = await api(register ? "/register" : "/login", {
                        username: f.get("username"),
                        password: f.get("password"),
                        inviteCode: f.get("inviteCode") || undefined,
                      });
                      setUser(d.user);
                      setAuth(false);
                      setNotice(t("Chào bạn. Trang giấy đã sẵn sàng."));
                    } catch (err: any) {
                      setError(err.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <label>
                    {t("Tên tài khoản")}
                    <input
                      name="username"
                      autoComplete="username"
                      required
                      minLength={3}
                      maxLength={40}
                      pattern="[a-zA-Z0-9_.\-]+"
                      placeholder={t("Tên bạn muốn dùng")}
                    />
                  </label>
                  <label>
                    {t("Mật khẩu")}
                    <input
                      name="password"
                      autoComplete={
                        register ? "new-password" : "current-password"
                      }
                      type="password"
                      required
                      minLength={10}
                      maxLength={128}
                      placeholder={t("Ít nhất 10 ký tự")}
                    />
                  </label>
                  {register && inviteRequired && (
                    <label>
                      {t("Mã mời")}
                      <input name="inviteCode" required />
                    </label>
                  )}
                  {error && (
                    <div className="inline-error" role="alert">
                      {t(error)}
                    </div>
                  )}
                  <button className="primary full" disabled={busy}>
                    {busy ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <ArrowRight size={16} />
                    )}{" "}
                    {register
                      ? t("Tạo không gian của mình")
                      : t("Mở nhật ký của mình")}
                  </button>
                </form>
                <button
                  className="text-button centered"
                  onClick={() => {
                    setRegister(!register);
                    setError("");
                  }}
                >
                  {register
                    ? t("Đã có tài khoản? Đăng nhập")
                    : t("Lần đầu ghé thăm? Tạo tài khoản")}
                </button>
                <p className="small muted">
                  {t(
                    "Bản thử nghiệm chưa hỗ trợ đặt lại mật khẩu. Hãy giữ mật khẩu của bạn.",
                  )}
                </p>
              </>
            )}
          </section>
        </div>
      )}
      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <article
            className="modal entry-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="entry-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close icon-button"
              aria-label={t("Đóng trang")}
              onClick={() => setSelected(null)}
            >
              <X size={20} />
            </button>
            <div className="date-line">
              {selected.mood} {date(selected.occurredAt)}
            </div>
            <h2 id="entry-title">
              {selected.title || t("Một ngày, vài dòng")}
            </h2>
            <p className="entry-full-body">{selected.body}</p>
            <Status
              entry={entries.find((e) => e.id === selected.id) || selected}
            />
            {selected.consent && (
              <div className="approved-memory">
                <span className="card-label">
                  <Sprout size={14} /> {t(" ĐƯỢC PHÉP NHỚ")}
                </span>
                <p>{selected.memory}</p>
              </div>
            )}
            {selected.error && (
              <p className="inline-error">{t(selected.error)}</p>
            )}
            <div className="button-row">
              <button className="secondary" onClick={() => openWrite(selected)}>
                <Feather size={15} /> {t(" Chỉnh trang")}
              </button>
              {selected.consent && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void forget(selected)}
                >
                  {t("Ngừng ghi nhớ")}
                </button>
              )}
              {selected.status !== "synced" && (
                <button
                  className="secondary"
                  onClick={async () => {
                    try {
                      await api(`/entries/${selected.id}/check`, {});
                      await refresh();
                      setNotice(t("Đang kiểm tra trạng thái lưu."));
                    } catch (e: any) {
                      setError(e.message);
                      setSelected(null);
                    }
                  }}
                >
                  {t("Kiểm tra lưu")}
                </button>
              )}
            </div>
            {selected.blobId && (
              <p className="blob-info">Walrus blob · {selected.blobId}</p>
            )}
          </article>
        </div>
      )}
    </div>
  );
}
function ArrowUpRight() {
  return <span aria-hidden="true">↗</span>;
}
