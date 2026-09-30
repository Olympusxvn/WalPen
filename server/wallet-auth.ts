import type { Express, Request, Response, RequestHandler } from "express";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { z } from "zod";
import type { Repository, UserRecord } from "./repository.ts";

const cookieName = "walpen_wallet_challenge";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const sui = new SuiGrpcClient({
  network: "mainnet",
  baseUrl: "https://fullnode.mainnet.sui.io:443",
});
const browserToken = (req: Request) =>
  req.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(cookieName + "="))
    ?.slice(cookieName.length + 1) || "";

export function addWalletAuth(
  app: Express,
  store: Repository,
  options: { production?: boolean; origin?: string; inviteCode?: string },
  limiter: RequestHandler,
  session: (
    req: Request,
  ) => Promise<{ id: string; username: string } | undefined>,
  setSession: (res: Response, id: string) => Promise<void>,
) {
  const cookieOptions = {
    httpOnly: true,
    secure: !!options.production,
    sameSite: "strict" as const,
    path: "/api/wallet",
  };
  app.post("/api/wallet/challenge", limiter, async (req, res) => {
    const parsed = z
      .object({
        address: z
          .string()
          .regex(/^0x[a-fA-F0-9]{64}$/)
          .transform((value) => value.toLowerCase()),
        link: z.boolean().default(false),
      })
      .safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Invalid Sui wallet address." });
    const user = parsed.data.link ? await session(req) : undefined;
    if (parsed.data.link && !user)
      return res
        .status(401)
        .json({
          error: "Sign in to the existing journal before linking a wallet.",
        });
    const id = randomUUID(),
      token = randomBytes(32).toString("hex"),
      expires = Date.now() + 5 * 60000;
    const message = [
      "WalPen — Sui wallet sign-in",
      `Origin: ${options.origin || "http://localhost"}`,
      `Wallet: ${parsed.data.address}`,
      `Action: ${user ? "Link wallet to existing account " + user.id : "Sign in to your journal"}`,
      `Nonce: ${id}`,
      `Issued at: ${new Date().toISOString()}`,
      `Expires at: ${new Date(expires).toISOString()}`,
      "This signature authenticates you to WalPen. It does not authorize a transaction or spend funds.",
    ].join("\n");
    await store.addWalletChallenge({
      id,
      address: parsed.data.address,
      message,
      browserHash: hash(token),
      expires,
      userId: user?.id || null,
    });
    res.cookie(cookieName, token, { ...cookieOptions, maxAge: 5 * 60000 });
    res.json({
      challengeId: id,
      message,
      expiresAt: new Date(expires).toISOString(),
    });
  });
  app.post("/api/wallet/verify", limiter, async (req, res) => {
    const parsed = z
      .object({
        challengeId: z.string().uuid(),
        signature: z.string().min(1).max(16000),
        inviteCode: z.string().max(200).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: "Invalid wallet sign-in request." });
    const tokenHash = hash(browserToken(req));
    const challenge = await store.getWalletChallenge(
      parsed.data.challengeId,
      tokenHash,
      Date.now(),
    );
    if (!challenge)
      return res
        .status(401)
        .json({
          error:
            "Sign-in request expired or was already used. Please sign again.",
        });
    if (challenge.userId && (await session(req))?.id !== challenge.userId)
      return res
        .status(401)
        .json({
          error: "Your account session changed. Start wallet linking again.",
        });
    try {
      await verifyPersonalMessageSignature(
        new TextEncoder().encode(challenge.message),
        parsed.data.signature,
        { address: challenge.address, client: sui },
      );
    } catch {
      return res
        .status(401)
        .json({
          error:
            "Wallet signature could not be verified. Please try signing again.",
        });
    }
    let user = await store.walletUser(challenge.address);
    if (user && challenge.userId && user.id !== challenge.userId)
      return res
        .status(409)
        .json({ error: "This wallet belongs to a different WalPen account." });
    if (
      !user &&
      !challenge.userId &&
      options.inviteCode &&
      parsed.data.inviteCode !== options.inviteCode
    )
      return res
        .status(403)
        .json({ error: "Enter the invitation code for your first visit." });
    if (
      !(await store.consumeWalletChallenge(challenge.id, tokenHash, Date.now()))
    )
      return res
        .status(401)
        .json({
          error: "This sign-in request was already used. Please sign again.",
        });
    if (!user) {
      const id = challenge.userId || randomUUID();
      const newUser: UserRecord = {
        id,
        username: `sui_${challenge.address.slice(2, 18)}_${challenge.address.slice(-8)}`,
        password: `${randomBytes(16).toString("hex")}:${randomBytes(64).toString("hex")}`,
        createdAt: new Date().toISOString(),
      };
      try {
        await store.bindWallet(challenge.address, newUser, !challenge.userId);
      } catch {
        return res
          .status(409)
          .json({
            error: "Account or wallet link changed. Reconnect and sign again.",
          });
      }
      user = (await store.walletUser(challenge.address))!;
    }
    await setSession(res, user.id);
    res.clearCookie(cookieName, cookieOptions);
    res.json({
      user: {
        id: user.id,
        username: user.username,
        walletAddress: challenge.address,
      },
    });
  });
}
