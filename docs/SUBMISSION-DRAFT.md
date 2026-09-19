# WalPen — submission preparation

Status: draft. Do not present this document as a submitted entry.

**Name:** WalPen

**Tagline:** A quiet journal. A companion that remembers what you choose.

**Audience:** People who want a low-pressure place to reflect and a companion that does not make them repeat the same context every session.

**Problem:** Journals preserve words, but ordinary stateless chat cannot use earlier reflections when a person returns. Uncontrolled memory capture also makes intimate writing uncomfortable.

**Solution:** Write freely, select a short memory in your own words, save it to Walrus and start a fresh conversation. WalPen recalls approved relevant memories, cites the source and lets you stop using them later. AI supports reflection rather than writing a diary for the user.

**LLM/runtime:** Ollama; configured model `qwen3:4b-instruct-2507-q4_K_M`. Confirm the actually running model before publication.

**Architecture:** Vercel frontend → temporary tunnel → local authenticated Node API → Walrus Memory Mainnet; Ollama runs locally. The frontend's availability does not imply the local backend is online.

**Before/after demo:** Use a fictional person who finds riverside walks calming. Save this with consent. Start a new chat with memory off, then a fresh chat with memory on. Ask the same question and show the actual answers and retrieved source cards. Do not hardcode a preferred answer or describe a test fixture as a real user.

**Evidence to attach:** verified public URL; public GitHub repo and reproduction instructions; actual agent ID; confirmed mainnet blob count; model/runtime; dedicated Sessions wallet; short video; genuine user feedback.

**Article outline:** Why journaling needs gentle memory; explicit consent flow; code path through remember and recall; truthful privacy boundary; observed before/after; integration friction with reproducible details; lessons and limitations.

**Publication and submission:** Article, social posts, external issue reports and final registration/submission need actual author/contact information and a final reviewed payload. None has been sent automatically by this implementation.
