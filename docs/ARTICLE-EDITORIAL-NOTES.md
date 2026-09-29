# WalPen — ghi chú keywords, bằng chứng và anti-slop

Article để copy nằm tại `ARTICLE-EN.md`; tài liệu này không phải phần thân bài. Ngôn ngữ: tiếng Anh, hướng tới người muốn xây chatbot có ký ức và giám khảo Walrus Session 8. Bản hiện tại là bài viết về tiến độ đã kiểm chứng, chưa phải bằng chứng hoàn tất yêu cầu người dùng thật.

## Keywords

| Từ khóa | Vị trí / mục đích |
|---|---|
| chatbot that remembers users between sessions | Tiêu đề và đoạn giới thiệu; mô tả đúng chức năng. |
| Walrus Memory | Mở bài, tích hợp và phản hồi SDK; không chèn lặp theo mật độ cố định. |
| journaling chatbot / WalPen | Tiêu đề và use case. |
| Ollama / Qwen3 / TypeScript SDK | Người tìm hướng dẫn kỹ thuật và track mô hình thay thế. |
| Mainnet / consent / recall / idempotency key | Thuật ngữ hỗ trợ; dùng tại đoạn có giải thích hành vi thật. |

Không nhét “support chatbot” vào tiêu đề chỉ vì đó là ví dụ từ khóa trong hướng dẫn: WalPen là ứng dụng nhật ký. Không hứa SEO ranking. Gợi ý tags nếu nền tảng hỗ trợ: `Walrus Memory`, `AI`, `Chatbots`, `Ollama`, `Journaling`.

**Subtitle:** An English/Vietnamese journal with approved memory excerpts, source references, and a local Qwen model.

**Meta description:** How WalPen uses Walrus Memory and local Qwen via Ollama to recall approved journal excerpts, cite sources, and handle uncertain writes.

## Kiểm tra giọng văn

- Mở bằng một truy vấn có ngày và kết quả cụ thể, không dùng “In today's fast-paced digital world”.
- Không dùng revolutionary, game-changing, seamless, cutting-edge, unlock, unleash, delve, leverage hoặc “the future of…”.
- Mỗi kết quả có phạm vi: fixture, kiểm thử tự động hay truy vấn live; không gom thành số liệu adoption.
- Dùng “I” như bản thảo cho tác giả dự án; không bịa cảm xúc, phỏng vấn hay trải nghiệm cá nhân. Tác giả nên duyệt trước khi xuất bản.
- Giữ câu mô tả lỗi và giới hạn vận hành. Không đánh đổi tính đúng để làm bài trơn tru hơn.
- Phân biệt tính năng đang chạy với đề xuất ticket; không nói API receipt lookup đã được triển khai.
- Mọi đoạn trích phải giữ câu gốc. Bản dịch được đánh dấu; không sửa câu chatbot rồi gọi đó là log gốc.
- Không tự thêm chứng nhận “human-written” hoặc điểm từ công cụ phát hiện AI.

## Bản đồ bằng chứng

| Nhận định trong article | Nguồn đã đọc |
|---|---|
| Dữ liệu gửi đi, namespace, SDK 0.1.7 | `server/memory.ts`, `package.json`. |
| Lọc theo quyền/revision, chặn trả lời lỗi thời | `server/app.ts`, `tests/app.test.ts`. |
| Giới hạn 768, tối đa 5 nguồn | `server/memory-context.ts`, `tests/memory-context.test.ts`. |
| Before/after ven sông | `data/evidence/public-e2e.json`, 19/09. Hai prompt khác ngôn ngữ nên chỉ mô tả là functional demonstration. |
| Năm trang đạt kiểm tra sau phục hồi | `data/evidence/five-days.json` và `five-days-report.md`, chạy ngày 19/09; không phải theo dõi người dùng năm ngày. |
| Truy vấn ngày 29/09: công viên/20 phút, khoảng 80 giây, 201 token ước tính | `data/evidence/pr-integration-live.json`. |
| Ba job failed rồi replacement thành công | `docs/MEMWAL-ENCRYPTION-INCIDENT.md`, issue #1047. |
| Đề xuất recovery/receipt lookup | Issues #1048 và #1049. |
| 16 tests/build | `docs/MEMWAL-PR-INTEGRATION.md`, kết quả kiểm tra của bản `3edbe27`. |

File `data/evidence/` không nằm trong Git. Không gửi toàn bộ log lên Medium: log chứa thêm định danh và dữ liệu ngoài phần cần minh họa. Chuẩn bị ảnh/log trích riêng, dùng dữ liệu giả lập hoặc nội dung được người dùng cho phép.

## Đối chiếu hướng dẫn sự kiện

[DeepSurge](https://www.deepsurge.xyz/hackathons/c0141a4a-21be-4009-bc63-7c168608c849) hướng dẫn bài khoảng 500–800 từ, giọng kể về công việc thực tế, before/after và bằng chứng sử dụng. Theo lựa chọn của tác giả, dùng [Event Rules](https://thewalrussessions.wal.app/chatbots/index.html) làm chuẩn số lượng: agent có ít nhất mười blob Mainnet. Không chuyển dòng ba người dùng × mười ký ức trên DeepSurge thành điều kiện chặn của checklist này; vẫn lưu nhận xét hai nguồn khác nhau. Đã kiểm tra ngày 29/09/2026; không lấy bài promo của thí sinh khác làm nguồn thể lệ.

Mốc mười blob đã có bằng chứng. Để bài thuyết phục hơn ở tiêu chí Real-World Use, bổ sung trải nghiệm qua các phiên và phản hồi được phép công bố. Bản hiện tại nói rõ bằng chứng đang là kiểm thử giả lập; không tự nhận đã có adoption.
