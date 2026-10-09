import type { Entry } from "./store.ts";
import type { WriteDraft, WriteLease } from "./write-intent.ts";

type Result<T> = T | Promise<T>;
export type UserRecord = {
  id: string;
  username: string;
  password: string;
  createdAt: string;
};
export type WalletChallenge = {
  id: string;
  address: string;
  message: string;
  browserHash: string;
  expires: number;
  userId: string | null;
};
export type TelegramLinkStatus = {
  telegramId: string;
  linkedAt: string;
};
export type TelegramLinkResult = "linked" | "invalid" | "expired" | "conflict";
export type TelegramInboundJob = {
  updateId: number;
  telegramId: string;
  chatId: string;
  text: string;
  language: "en" | "vi";
};
export const TELEGRAM_MAX_ATTEMPTS = 5;
export interface Repository {
  addWalletChallenge(challenge: WalletChallenge): Result<void>;
  getWalletChallenge(
    id: string,
    browserHash: string,
    now: number,
  ): Result<WalletChallenge | undefined>;
  consumeWalletChallenge(
    id: string,
    browserHash: string,
    now: number,
  ): Result<boolean>;
  walletUser(address: string): Result<UserRecord | undefined>;
  bindWallet(address: string, user: UserRecord, create: boolean): Result<void>;
  session(
    token: string,
    now: number,
  ): Result<{ id: string; username: string } | undefined>;
  addSession(token: string, userId: string, expires: number): Result<void>;
  deleteSession(token: string): Result<void>;
  userByName(username: string): Result<UserRecord | undefined>;
  addUser(user: UserRecord): Result<void>;
  issueTelegramLinkCode(input: {
    telegramId: string;
    codeHash: string;
    createdAt: number;
    expiresAt: number;
  }): Result<boolean>;
  telegramUserId(telegramId: string): Result<string | undefined>;
  telegramLinkForUser(userId: string): Result<TelegramLinkStatus | undefined>;
  consumeTelegramLinkCode(
    codeHash: string,
    userId: string,
    now: number,
  ): Result<TelegramLinkResult>;
  enqueueTelegramUpdate(
    input: TelegramInboundJob,
    now: number,
  ): Result<{
    created: boolean;
    state: "queued" | "processing" | "done" | "failed" | "uncertain";
  }>;
  pendingTelegramUpdateIds(now: number, limit: number): Result<number[]>;
  claimTelegramUpdate(
    updateId: number,
    now: number,
    leaseUntil: number,
  ): Result<TelegramInboundJob | undefined>;
  finishTelegramUpdate(
    updateId: number,
    status: "done" | "failed" | "uncertain",
    now: number,
    safeErrorCode?: string,
  ): Result<void>;
  releaseTelegramUpdate(
    updateId: number,
    nextAttemptAt: number,
    safeErrorCode: string,
  ): Result<void>;
  insertTelegramEntry(
    updateId: number,
    entry: Entry,
  ): Result<{ entry: Entry; created: boolean }>;
  get(id: string, userId: string): Result<Entry | undefined>;
  list(userId: string, all?: boolean): Result<Entry[]>;
  pending(userId?: string, windowMs?: number, now?: number): Result<Entry[]>;
  insert(entry: Entry): Result<void>;
  claim(
    id: string,
    draft: WriteDraft,
    windowMs: number,
    now: number,
  ): Result<WriteLease | undefined>;
  writeIntent(id: string): Result<WriteLease | undefined>;
  sync(
    id: string,
    status: string,
    jobId: string | null,
    blobId: string | null,
    error: string | null,
    leaseToken?: string,
  ): Result<boolean>;
}
