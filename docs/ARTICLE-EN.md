# WalPen: A Journaling Chatbot That Remembers Users Between Sessions

![An open journal, a selected memory card and a conversation recalling the same park scene.](assets/walpen-article-cover.png)

*Concept illustration: an approved journal excerpt becomes context for a later conversation. This is not an application screenshot.*

On 29 September, I opened a fresh conversation with WalPen and asked where the fictional journal character An had walked on 15 September. It answered: in the park, for 20 minutes, with a reference to the saved entry. The previous conversation was absent. Walrus Memory supplied the context.

I built WalPen for people who want to return to a journal conversation without explaining the same background again. Inspired by [Pause & Pen](https://github.com/Olympusxvn/pause-and-pen), it combines an English/Vietnamese journal with a chatbot that remembers users between sessions. The user chooses an editable excerpt that the companion may recall. Chat messages do not automatically become memories.

That choice needs a precise explanation. Saving a page uploads the journal record to Walrus, including its body, title, dates, revision information and memory excerpt. Approval controls which excerpt enters the chatbot's context; it does not limit storage to that excerpt. Withdrawing permission stops future use in WalPen, but does not erase an existing Walrus blob.

The integration uses the TypeScript SDK, `@mysten-incubation/memwal@0.1.7`, on Mainnet. An authenticated Node backend creates a namespace from the user's server-side ID. It calls `remember()`, saves the returned job ID locally, and waits for confirmation with `waitForRememberJob()`. The interface reports a confirmed save only after receiving a blob ID. An encrypted SQLite cache preserves journal revisions and recovery state. A separate verification recorded ten distinct confirmed Mainnet blobs.

When a message arrives, the backend calls `recall()` with the question. It checks the returned records against the user's active, confirmed, approved revisions and verifies the excerpt. Only those excerpts reach Ollama. Source cards expose the entry date and blob ID so the answer can be checked against the stored record. The [source and setup instructions](https://github.com/Olympusxvn/WalPen) show this path.

WalPen runs **Qwen3 4B Instruct 2507**, specifically `qwen3:4b-instruct-2507-q4_K_M`, through **Ollama**. Following [MemWal PR #605](https://github.com/MystenLabs/MemWal/pull/605), the app uses the SDK's budgeting helper after permission checks. It keeps whole excerpts, up to five sources and 768 estimated memory-context tokens. That estimate excludes the rest of the prompt and is not exact Qwen tokenization. If a user edits or withdraws a selected memory during generation, WalPen discards the outdated answer.

For the before/after check, I used a fictional fact: walking beside the river helps An feel calm. With memory disabled, a fresh chat returned no saved activity and no sources. With memory enabled, another fresh chat answered, “Đi bộ ven sông giúp An bình tĩnh [1]” — walking beside the river helps An feel calm. The prompts asked the same question in English and Vietnamese respectively, so this was a functional demonstration, not a controlled comparison of answer quality.

I also tested five fictional journal pages dated 15–19 September. After recovery from write failures, all five questions returned the expected fact and source in fresh chats. These pages were created and tested on 19 September; their dates do not represent five days of real-user adoption. The 29 September check retrieved an existing page again, used 201 estimated memory-context tokens, and took about 80 seconds on the local CPU host. Sixteen automated tests pass. Real-user feedback is still missing.

Three of the five initial writes exposed the clearest integration problem. Accepted jobs later reported “Upstream Unavailable: Memory encryption backend is unavailable.” I checked their terminal failure states before creating replacement revisions sequentially; those writes succeeded. [Issue #1047](https://github.com/MystenLabs/MemWal/issues/1047) records the job IDs and timing. The underlying service failure still needs maintainer investigation.

A timeout requires different handling: the write may already have been accepted. WalPen preserves uncertain states rather than blindly resubmitting. I opened [#1048](https://github.com/MystenLabs/MemWal/issues/1048) for a durable recovery guide and [#1049](https://github.com/MystenLabs/MemWal/issues/1049) for read-only receipt lookup by idempotency key. The SDK already supports idempotent writes; the remaining proposal concerns recovering an acknowledgement when the job ID was lost.

The [live demo](https://walpen.vercel.app) uses Vercel for the frontend and a temporary tunnel to the local API and Ollama. It requires that machine to stay awake. Local inference also does not make the system fully offline or end-to-end encrypted: the hosted MemWal relayer processes plaintext for embedding and encryption.

My next step is watching people use WalPen across several sessions and checking which recalls actually help them continue a conversation. The synthetic tests establish that the storage and retrieval path works. They leave that product question open.
