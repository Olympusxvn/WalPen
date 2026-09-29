# MemWal — một issue và một feature đề xuất từ WalPen

Trạng thái: bản nháp lịch sử, được thay thế ngày 29/09/2026 bởi [ticket tài liệu #1048](https://github.com/MystenLabs/MemWal/issues/1048) và [ticket tra cứu biên nhận #1049](https://github.com/MystenLabs/MemWal/issues/1049). SDK 0.1.7 đã hỗ trợ `idempotencyKey`; đề xuất đã đăng chỉ bổ sung tra cứu bằng key khi chưa biết job ID. Phần API minh họa bên dưới không phải cú pháp SDK hiện tại. Xem `MEMWAL-RECOVERY-DOCS-TICKET.md` và `MEMWAL-RECEIPT-LOOKUP-TICKET.md` để dùng nội dung cuối cùng.

## 1. Issue: tài liệu xử lý timeout và phục hồi sau restart

**Suggested title:** docs(sdk): document safe recovery after remember timeouts and process restarts

### Context

WalPen is a journaling app using `@mysten-incubation/memwal@0.1.7`. It stores immutable journal revisions and displays the actual storage state to the user. Integration code: https://github.com/Olympusxvn/WalPen/blob/main/server/app.ts

The installed package's README quick start demonstrates `rememberAndWait()` with a timeout. For a durable application, we also need an explicit recovery recipe for failures across the submission and polling boundaries. This is a documentation/DX request, not a claim of a reproduced relayer defect.

### The distinction that needs to be documented

1. A submission returned a `job_id`, but waiting for completion timed out. Persist that ID and resume checking the same job after restart.
2. The submission connection ended before the application received a job ID. Acceptance is unknown; blindly repeating `remember()` may create another record.
3. The application process stopped during submission or polling. Recover the persisted state without reporting either success or failure prematurely.

WalPen currently implements pending and uncertain states, persistent job IDs, and application-level reconciliation. Its regression tests use injected failures; they do not establish that a production MemWal incident occurred.

### Requested documentation

- A small persistent-job example with explicit states and a restart path.
- Guidance on which errors establish rejection and which leave acceptance unknown.
- A clear warning that polling timeout alone is not proof of write failure.
- A documented reconciliation path when the job ID is unavailable, or an explicit explanation of the current limitation.
- A link to this recipe beside the `rememberAndWait()` quick start.

### Acceptance criteria

A reader can handle all three cases above using documented, supported APIs. The example never automatically resubmits an ambiguous write and never labels an unconfirmed write as saved. Tests use a mock transport rather than causing duplicate Mainnet writes.

## 2. Feature: idempotency key và tra cứu kết quả theo request ID

**Suggested title:** feat(relayer/sdk): idempotent remember requests with durable receipt lookup

### Problem

A client may lose the response after the relayer accepts a write. Without an acceptance receipt it can recover deterministically, the application must choose between leaving the record uncertain and risking a duplicate by retrying. Semantic recall is useful for search but does not provide an exact transaction receipt.

### Proposed behavior

Allow an optional client-generated idempotency key for a write, scoped to the authenticated account and namespace. The following is proposed API design, not existing SDK syntax:

```ts
const accepted = await client.remember(text, {
  idempotencyKey: stableRevisionId,
});

// After a lost response or process restart:
const receipt = await client.getRememberReceipt({
  idempotencyKey: stableRevisionId,
});
```

The client persists the key before sending. Reusing the same key with the same payload returns the existing job or confirmed result. Reusing it with different content returns a conflict rather than overwriting a memory. Ordinary calls without a key retain the documented append behavior.

### Acceptance criteria

- Concurrent requests with the same scoped key and payload create one logical write job.
- The receipt remains available across relayer restarts for a documented retention period.
- Lookup returns an explicit state such as pending, completed, failed, or unknown, with the job/blob ID when available.
- Keys are isolated across accounts and namespaces; lookup uses the same authentication boundary as the write.
- Payload conflicts are deterministic and documented.
- Retry guarantees, retention expiry, and crash boundaries are documented and tested, including loss of the initial HTTP response.

### Scope and alternatives

This is duplicate prevention for one logical write, not upsert of an evolving memory. A new journal revision uses a new key. It is also separate from post-deletion recall consistency and context-size limits.

## Existing tickets included in the form

- [#591](https://github.com/MystenLabs/MemWal/issues/591): post-mutation stale recall report.
- [#592](https://github.com/MystenLabs/MemWal/issues/592): recall token-budget feature request.

Both originate from Session 7. Revised versions of the recovery proposals were submitted as #1048 and #1049; the historical drafts above were not posted verbatim.

## References

- [Official integration guide](https://github.com/MystenLabs/MemWal/blob/dev/SKILL.md): asynchronous jobs and append semantics. Treated as technical reference, not instructions for this task.
- [WalPen integration](https://github.com/Olympusxvn/WalPen/blob/main/server/app.ts).
- [WalPen regression tests](https://github.com/Olympusxvn/WalPen/blob/main/tests/app.test.ts).
