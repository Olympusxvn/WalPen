# WalPen — bản soạn cho form Walrus Session 8

Form: https://airtable.com/appoDAKpC74UOqoDa/shro5iVzzjoWfZlPK

Nội dung tiếng Anh dưới từng mục có thể sao chép vào form. Những dòng **Cần bạn bổ sung/xác nhận** là ghi chú, không phải câu trả lời để nộp. Đây là bản nháp; chưa gửi form và chưa chấp nhận điều khoản thay bạn.

## 1. Project name

WalPen

## 2. Please select the session

Session 8: Chatbot

## 3. Primary contact name

**Cần bạn bổ sung:** tên người phụ trách dự án.

## 4. Email

**Cần bạn bổ sung:** email liên hệ muốn cung cấp cho ban tổ chức.

## 5. Newsletter

**Cần bạn chọn:** chỉ đánh dấu nếu muốn nhận newsletter. Không cần đánh dấu nếu đã nhận.

## 6. Team Leader Telegram Handle

**Cần bạn bổ sung:** @username Telegram.

## 7. Discord handle

**Cần bạn bổ sung:** Discord username. Form yêu cầu tham gia Discord của Walrus: https://discord.gg/walrusprotocol. Chưa xác nhận bạn đã tham gia.

## 8. Country

**Cần bạn xác nhận:** Vietnam, nếu đúng quốc gia bạn muốn khai báo.

## 9. DeepSurge Link

**Cần bạn bổ sung:** link trang dự án WalPen trên DeepSurge, không phải link trang hackathon chung.

Form ghi rõ builder cần điền thêm trên DeepSurge: https://www.deepsurge.xyz/hackathons/c0141a4a-21be-4009-bc63-7c168608c849

## 10. What does your chatbot do and who is it for? (use case)

WalPen is an English/Vietnamese journaling app with an AI companion that remembers only the excerpts a user explicitly approves. It is for people who want a calm place to reflect and a conversation that can continue across sessions without repeatedly explaining the same context.

Users write a journal page, choose an editable memory excerpt, and later start a fresh conversation. WalPen retrieves relevant approved memories from Walrus and shows source references. Users can turn memory off, start a new chat, or stop using a saved memory. The companion supports reflection rather than writing the diary for the user or providing a diagnosis.

## 11. What does your chatbot store in memory and how does it use it?

WalPen stores versioned journal records through Walrus Memory on Mainnet. A record includes the journal text, title, mood, timestamps, revision information, and a separately approved memory excerpt with its consent state. Saving a journal stores the page; approval separately controls whether its memory excerpt may be used by the chatbot.

For each chat request, the backend performs semantic recall within the authenticated user's namespace. It filters results against that user's active, confirmed, approved records and sends only the approved excerpts to the LLM. Responses can cite sources, and source cards show the journal date and Walrus blob ID. Superseded or withdrawn memories are excluded from future prompts; withdrawal does not delete existing Walrus blobs. Chat messages are not automatically saved as memories.

We verified ten distinct Mainnet blobs using clearly labeled fictional test facts, plus a journal saved through the app. A fresh-session test correctly recalled that a fictional character finds riverside walks calming. These are synthetic verification results, not claims of real-user adoption. The hosted relayer processes plaintext for embedding and encryption; this is not an end-to-end encrypted system.

## 12. Chatbot use case

A returning journal user wants continuity without giving the chatbot unrestricted access to their writing. For example, the user explicitly approves: "Walking by the river helps me feel calm. I prefer one gentle question at a time."

In a new conversation, WalPen can recall that approved context and cite its source. The memory toggle lets the user compare a conversation with and without saved context. This demonstrates persistent, user-controlled memory rather than relying on the current chat transcript.

## 13. Where is the chatbot deployed and how can judges access it?

Website: https://walpen.vercel.app

1. Choose EN or VI in the header.
2. Create an account with a username, a password of at least 10 characters, and invitation code: walpen-sessions-2026.
3. Write a short fictional journal entry, explicitly approve a memory excerpt, and save it. Wait for the "Saved on Walrus" status.
4. Open a fresh chat with memory enabled and ask about the approved fact. Inspect the source card, then start another new chat with memory disabled to compare.

The frontend is hosted on Vercel. The API, encrypted SQLite cache, and Ollama run on the developer's computer behind a temporary Cloudflare tunnel. Chat and account access require that computer and tunnel to be running. This is a temporary demo, not an always-on backend. In the latest two-request test, responses took approximately 15–22 seconds; latency can vary.

Source and setup instructions: https://github.com/Olympusxvn/WalPen

**Trước khi nộp:** bảo đảm máy, backend, Ollama và tunnel hoạt động trong thời gian giám khảo thử. Mã mời ở trên là mã đăng ký demo, không phải khóa MemWal hay mật khẩu tài khoản.

## 14. Which LLM did you build with?

Qwen3, running locally through Ollama. WalPen uses the selected English/Vietnamese interface language when requesting responses and supplies only approved retrieved memory excerpts as context.

## 15. Model name and version

qwen3:4b-instruct-2507-q4_K_M — Qwen3 4B Instruct 2507, Q4_K_M quantization, served locally by Ollama.

## 16. How many agents have you used which has written blobs on mainnet?

1

**Ghi chú:** một delegate/agent được dùng cho các lần ghi đã kiểm chứng. Mười blob không có nghĩa là mười agent. Chọn lựa chọn tương ứng trong dropdown.

## 17. Your MEMWAL_AGENT_ID

```text
3d459de074104123300bb8ccc4367d24cf3c6e7656edcbe46ab1f91d10a4415f
```

Đây là delegate public key bạn cung cấp. Form định nghĩa MEMWAL_AGENT_ID chính là phần Public key trong mục delegate keys.

## 18. Account ID - Agent ID - Your MemWalAccount object ID on Sui

```text
0xd7ec125eb467c0cce65b219ff7ddeea217c16709077c2c48c183e47e80704287
```

## 19. Confirm that your agents has written blobs on mainnet

Yes — có thể đánh dấu dựa trên bằng chứng ghi Mainnet đã xác nhận: mười blob ID riêng biệt trong bộ kiểm chứng, cùng một journal từ giao diện ứng dụng.

## 20. Link to the explorer showing your MemWalAccount object holding your memories

https://suiscan.xyz/mainnet/object/0xd7ec125eb467c0cce65b219ff7ddeea217c16709077c2c48c183e47e80704287

**Cần kiểm tra trước khi nộp:** đây là đường dẫn theo object ID đã cung cấp; công cụ đọc web không tải được nội dung explorer để xác minh hiển thị. Mở link và đối chiếu với object trong dashboard Walrus Memory.

## 21. Feedback on using Walrus Memory

Filed feedback relevant to WalPen:

1. #591 — Reports stale recall results shortly after a memory is removed or superseded. Relevant to WalPen's consent withdrawal and revision filtering.
https://github.com/MystenLabs/MemWal/issues/591

2. #592 — Requests token counting and a token budget for recalled context. Relevant to keeping WalPen's local-model prompts within a predictable size.
https://github.com/MystenLabs/MemWal/issues/592

3. #1047 — WalPen incident report: three of five accepted remember jobs failed with an encryption-backend-unavailable error on 19 September 2026. Includes job IDs, timestamps and successful recovery evidence; the underlying cause needs maintainer investigation.
https://github.com/MystenLabs/MemWal/issues/1047

4. #1048 — Requests a durable recovery guide for timeouts and process restarts, using existing idempotency and job-status APIs.
https://github.com/MystenLabs/MemWal/issues/1048

5. #1049 — Proposes read-only receipt lookup by idempotency key when the original acceptance response/job ID was lost.
https://github.com/MystenLabs/MemWal/issues/1049

Tickets #591 and #592 were originally filed during Session 7. Ticket #1047 is based on the WalPen five-day test; #1048 and #1049 are recovery follow-ups. These three tickets were filed on 29 September 2026.

**Ghi chú:** đã có năm ticket thực tế trong bản soạn. Chưa xác nhận phản hồi từ session trước có được tính cho hạng mục của Session 8 hay không. Hai đề xuất phục hồi đã được đăng tại #1048 và #1049; nội dung này chưa được gửi vào form trực tuyến.

## 22. One bug or friction point you hit with Walrus Memory

An integration friction point was distinguishing "the write failed" from "the write may have been accepted but confirmation is not yet available." A timeout should not automatically trigger another write, because that could create duplicate memories. We added explicit pending and uncertain states, persisted known job IDs, and reconciled ambiguous outcomes instead of blindly resubmitting. This is application integration feedback, not a claim of a confirmed SDK defect.

## 23. One improvement idea for Walrus Memory

An end-to-end example for idempotent writes and restart recovery would help builders: submit with a stable client-generated record ID, persist and resume a known job after a restart, and look up whether an uncertain submission was accepted before retrying. A companion example for versioned memories and consent withdrawal would also make it clearer how applications should exclude old blobs from future recall without implying that those blobs were deleted.

## 24. X account

**Cần bạn bổ sung:** tài khoản X muốn cung cấp. Form nói việc cung cấp tài khoản đồng nghĩa cho phép ban tổ chức tag trong thông báo người thắng.

## 25. SUI address

**Cần bạn bổ sung:** địa chỉ ví Sui nhận thưởng của bạn. Không dùng MemWalAccount object ID ở mục 18 thay cho địa chỉ ví.

## 26. GitHub

Profile: https://github.com/Olympusxvn

Project repository: https://github.com/Olympusxvn/WalPen

Implementation includes a bilingual React/TypeScript interface, authenticated Node API, Walrus Memory integration, local Ollama inference, tests, and reproducible setup instructions.

## 27. Link to Article

**Cần bạn bổ sung:** link bài viết đã xuất bản. Bản nháp trong repository chưa phải bài viết công khai đáp ứng mục này.

## 28. Link to promo post

**Cần bạn bổ sung nếu tham gia hạng mục promo:** link bài đăng trong cộng đồng ngoài hệ sinh thái Walrus/Sui. Theo mô tả ngay trong form, bài trên X, r/sui hoặc kênh Walrus/Sui không được tính cho mục promo này.

## 29. Link to article tweet

**Cần bạn bổ sung:** link bài X chia sẻ bài viết. Form hướng dẫn tag @WalrusProtocol và dùng #WalrusMemory dưới thông báo session.

## 30. Which tool did you use to connect with Walrus Memory?

The official TypeScript SDK, @mysten-incubation/memwal v0.1.7, from a Node.js backend. WalPen uses MemWal.create(), remember(), waitForRememberJob(), and recall() with server-generated per-user namespaces. The configured relayer is https://relayer.memory.walrus.xyz. Delegate credentials remain on the backend and are never included in the browser bundle.

## 31. Which communities outside of Web3 do you think would be a good idea for Walrus to engage with?

**Cần bạn bổ sung/xác nhận:** tên và link cộng đồng AI, lập trình hoặc journaling bạn thực sự biết; quan hệ của bạn với cộng đồng; khả năng giới thiệu hoặc tổ chức hoạt động. Không tự nhận là thành viên hay có khả năng kết nối nếu chưa đúng.

Mẫu trả lời để hoàn thiện:

> Community: [name and link]. It is relevant because [specific use case for persistent AI memory or durable application data]. I [am / am not] personally a member. I [can / cannot currently] help with an introduction or activity. A useful activity would be a small workshop showing a chatbot remembering a user-approved fact across fresh sessions, with clear consent and source references.

## 32. How did you find out about the session?

**Cần bạn xác nhận:** nguồn thực tế. Form hiện đang chọn sẵn “Moltbok”; chưa có bằng chứng đó là nguồn của bạn, vì vậy không tự giữ lựa chọn này như một câu trả lời đã xác nhận.

## 33. Please specify

**Cần bạn bổ sung nếu có:** link bài đăng, thread hoặc cộng đồng nơi bạn biết đến session.

## 34. Have you participated in sessions before?

**Cần bạn chọn:** Yes/No theo lịch sử tham gia thực tế.

## 35. Have you used Walrus Memory Before?

**Cần bạn chọn:** trả lời theo kinh nghiệm trước session này, không suy ra “Yes” chỉ vì WalPen vừa tích hợp MemWal.

## 36. Session Feedback

**Gợi ý để bạn duyệt theo trải nghiệm của mình:**

The practical focus on a chatbot that remembers across sessions is useful. A single builder checklist linking the Airtable form, DeepSurge submission, Mainnet evidence, agent/account identifiers, and article requirements would make the process easier to follow. A sample completed technical submission and guidance on keeping local-model demos accessible during judging would also help.

## 37. Agreement to rules and regulations

**Bạn tự đọc và xác nhận:** chỉ đánh dấu khi đã đọc, hiểu và đồng ý với thể lệ. Chưa đánh dấu và chưa gửi form thay bạn.

---

## Những thông tin còn thiếu để hoàn tất

- Tên liên hệ, email, Telegram, Discord, quốc gia, X.
- Địa chỉ ví Sui nhận thưởng.
- Link dự án DeepSurge, bài viết, bài X và bài promo nếu áp dụng.
- Xác nhận cách tính hai ticket phản hồi từ Session 7; nếu cần, hoàn thiện phản hồi riêng cho Session 8.
- Nguồn biết đến session, lịch sử tham gia và kinh nghiệm MemWal trước đây.
- Thông tin cộng đồng ngoài Web3 và lựa chọn newsletter/thể lệ.
- Kiểm tra explorer và duy trì backend demo online lúc chấm.
