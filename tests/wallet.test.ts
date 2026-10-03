import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import request from "supertest";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Store } from "../server/store.ts";
import { createApp } from "../server/app.ts";

function setup() {
  const store = new Store(":memory:", randomBytes(32));
  const memory = {
    configured: false,
    prepare: () => {
      throw new Error("Memory disabled");
    },
    remember: async () => "job",
    wait: async () => "blob",
    recall: async () => ({ results: [] }),
  };
  const model = {
    configured: false,
    name: "none",
    answer: async () => "unused",
  };
  const { app } = createApp(store, memory, model, {
    origin: "http://localhost",
    rateLimits: false,
    inviteCode: "judge-invite",
  });
  return { store, app };
}
async function signature(key: Ed25519Keypair, message: string) {
  return (await key.signPersonalMessage(new TextEncoder().encode(message)))
    .signature;
}

test("wallet sign-in verifies a real signature, consumes the nonce and retains identity", async (t) => {
  const { store, app } = setup();
  t.after(() => store.db.close());
  const key = new Ed25519Keypair(),
    address = key.toSuiAddress();
  const agent = request.agent(app);
  const challenge = (
    await agent.post("/api/wallet/challenge").send({ address }).expect(200)
  ).body;
  assert.match(challenge.message, /Origin: http:\/\/localhost/);
  assert.ok(challenge.message.includes(address));
  const body = {
    challengeId: challenge.challengeId,
    signature: await signature(key, challenge.message),
  };
  await agent.post("/api/wallet/verify").send(body).expect(403);
  const signed = await agent
    .post("/api/wallet/verify")
    .send({ ...body, inviteCode: "judge-invite" })
    .expect(200);
  assert.equal(signed.body.user.walletAddress, address);
  await agent.post("/api/wallet/verify").send(body).expect(401);
  const resumed = request.agent(app);
  const next = (
    await resumed.post("/api/wallet/challenge").send({ address }).expect(200)
  ).body;
  const again = await resumed
    .post("/api/wallet/verify")
    .send({
      challengeId: next.challengeId,
      signature: await signature(key, next.message),
    })
    .expect(200);
  assert.equal(again.body.user.id, signed.body.user.id);
  assert.equal(
    (await resumed.get("/api/session")).body.user.walletAddress,
    address,
  );
});

test("wallet auth rejects another signer, another browser and expired challenges", async (t) => {
  const { store, app } = setup();
  t.after(() => store.db.close());
  const key = new Ed25519Keypair(),
    stranger = new Ed25519Keypair();
  const agent = request.agent(app);
  const challenge = (
    await agent
      .post("/api/wallet/challenge")
      .send({ address: key.toSuiAddress() })
      .expect(200)
  ).body;
  await agent
    .post("/api/wallet/verify")
    .send({
      challengeId: challenge.challengeId,
      signature: await signature(stranger, challenge.message),
      inviteCode: "judge-invite",
    })
    .expect(401);
  const body = {
    challengeId: challenge.challengeId,
    signature: await signature(key, challenge.message),
    inviteCode: "judge-invite",
  };
  await request(app).post("/api/wallet/verify").send(body).expect(401);
  store.db
    .prepare("UPDATE wallet_challenges SET expires=0 WHERE id=?")
    .run(challenge.challengeId);
  await agent.post("/api/wallet/verify").send(body).expect(401);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM users").get()!.n, 0);
});

test("linking requires the existing session and never takes over another account", async (t) => {
  const { store, app } = setup();
  t.after(() => store.db.close());
  const key = new Ed25519Keypair(),
    address = key.toSuiAddress();
  await request(app)
    .post("/api/wallet/challenge")
    .send({ address, link: true })
    .expect(401);
  const alice = request.agent(app),
    bob = request.agent(app);
  const aliceId = (
    await alice
      .post("/api/register")
      .send({
        username: "alice",
        password: "private-password-123",
        inviteCode: "judge-invite",
      })
      .expect(201)
  ).body.user.id;
  await bob
    .post("/api/register")
    .send({
      username: "bob",
      password: "private-password-123",
      inviteCode: "judge-invite",
    })
    .expect(201);
  const first = (
    await alice
      .post("/api/wallet/challenge")
      .send({ address, link: true })
      .expect(200)
  ).body;
  const linked = await alice
    .post("/api/wallet/verify")
    .send({
      challengeId: first.challengeId,
      signature: await signature(key, first.message),
    })
    .expect(200);
  assert.equal(linked.body.user.id, aliceId);
  assert.equal(linked.body.user.username, "alice");
  const second = (
    await bob
      .post("/api/wallet/challenge")
      .send({ address, link: true })
      .expect(200)
  ).body;
  await bob
    .post("/api/wallet/verify")
    .send({
      challengeId: second.challengeId,
      signature: await signature(key, second.message),
    })
    .expect(409);
  assert.equal(store.walletUser(address)!.id, aliceId);
});
