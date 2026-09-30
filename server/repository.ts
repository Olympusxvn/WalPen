import type { Entry } from "./store.ts";

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
  get(id: string, userId: string): Result<Entry | undefined>;
  list(userId: string, all?: boolean): Result<Entry[]>;
  pending(userId?: string): Result<Entry[]>;
  insert(entry: Entry): Result<void>;
  claim(id: string): Result<boolean>;
  sync(
    id: string,
    status: string,
    jobId: string | null,
    blobId: string | null,
    error: string | null,
  ): Result<void>;
}
