# WalPen — checklist nộp Walrus Session 8

Đối chiếu ngày 29/09/2026. Theo lựa chọn của tác giả, checklist lấy Event Rules làm chuẩn chính. Đây là checklist chuẩn bị; chưa xác nhận hồ sơ đã nộp.

## Nguồn và thời hạn

- [DeepSurge — trang cuộc thi](https://www.deepsurge.xyz/hackathons/c0141a4a-21be-4009-bc63-7c168608c849): hướng dẫn build, sử dụng, article và 3 người dùng × 10 ký ức/người.
- [Event Rules](https://thewalrussessions.wal.app/chatbots/index.html): thời hạn 09/10/2026 lúc 14:00 UTC, tức **21:00 giờ Việt Nam**; điều kiện Mainnet, wallet, đăng ký và công bố bài.
- [Form dự án](https://airtable.com/appoDAKpC74UOqoDa/shro5iVzzjoWfZlPK). Chuẩn bị câu trả lời từ bằng chứng và thông tin liên hệ đã xác nhận.

**Chuẩn số lượng được dùng:** Event Rules ghi agent có ít nhất 10 blob Mainnet tại lúc nộp. WalPen đã có bằng chứng mười blob riêng biệt của agent; không cần diễn giải điều này thành 10 blob cho mỗi người dùng.

**Khác biệt nguồn, không phải mục chặn trong checklist này:** DeepSurge còn ghi 3 người dùng × 10 ký ức/người. Trang Event Rules không ghi ngưỡng đó. Ghi nhận sự khác nhau để tránh khẳng định hai trang hoàn toàn thống nhất; chưa có xác nhận của ban tổ chức rằng dòng DeepSurge đã được bỏ. DeepSurge mô tả thưởng bằng stablecoin, Event Rules ghi WAL; article không khẳng định đồng chi trả.

## Trạng thái dự án

| Hạng mục | Trạng thái ngày 29/09 | Bằng chứng / bước tiếp theo |
|---|---|---|
| Chatbot và repo công khai | Đã có | [Demo](https://walpen.vercel.app), [mã nguồn + hướng dẫn](https://github.com/Olympusxvn/WalPen). Commit kiểm chứng: `3edbe27`. |
| Ghi Mainnet | Đã kiểm chứng tối thiểu 10 blob riêng biệt | `data/evidence/walrus-verification.json`; đối chiếu lại agent/count trên dashboard khi nộp. |
| Recall giữa các phiên | Đã kiểm chứng bằng dữ liệu giả lập | Năm trang fixture, lịch sử chat rỗng, đúng fact và nguồn; kiểm tra lại một trang ngày 29/09. |
| Mô hình và runtime | Đã xác định | Qwen3 4B Instruct 2507 Q4_K_M qua Ollama. Có cơ sở đăng ký Beyond the Big Two; ban tổ chức quyết định kết quả. |
| Chất lượng tích hợp | Đã kiểm chứng | 16 test, build thành công; chặn nguồn chưa được duyệt, phiên bản cũ và race khi rút quyền. |
| Bằng chứng sử dụng thật | Cần bổ sung để củng cố tiêu chí Real-World Use | Có log kiểm thử giả lập; chưa có phản hồi người dùng thật. Không áp ngưỡng ba người theo Event Rules. |
| Vận hành lúc chấm | Còn phụ thuộc máy local | Máy, Ollama, API và tunnel cần chạy; sau restart tunnel phải cập nhật Vercel. |
| Feedback MemWal | Đã mở ticket | [#1047](https://github.com/MystenLabs/MemWal/issues/1047), [#1048](https://github.com/MystenLabs/MemWal/issues/1048), [#1049](https://github.com/MystenLabs/MemWal/issues/1049). Ticket là bằng chứng phản hồi, chưa phải bounty được chấp nhận. |
| Article | Đã soạn tiếng Anh | `ARTICLE-EN.md`; còn thiếu trải nghiệm người dùng thật và URL Medium/Inkray. |
| Đăng ký / nộp hồ sơ | Chưa xác minh | DeepSurge, Airtable, thông tin liên hệ, ví Sessions, Discord và bài X. |

## Việc cần làm trước khi xuất bản

- [ ] Bổ sung trải nghiệm sử dụng thực tế qua các phiên và giữ demo truy cập được lúc chấm; không đặt số người dùng tối thiểu ngoài Event Rules.
- [x] Agent đã ghi ít nhất mười blob Mainnet riêng biệt theo bằng chứng kiểm chứng hiện có. Đối chiếu lại dashboard và số blob khi nộp.
- [ ] Ghi ngày sử dụng thực tế, số ký ức xác nhận, một câu hỏi ở phiên mới và nguồn trả về cho từng người. Nhãn ngày trong fixture không phải ngày sử dụng.
- [ ] Chạy cặp đối chiếu mới: cùng tài khoản, cùng câu hỏi, cùng ngôn ngữ, lịch sử rỗng; một lần tắt và một lần bật ký ức. Giữ cả câu trả lời gốc.
- [ ] Khi có người thử, ghi phản hồi cụ thể: ký ức nào có ích, nguồn nào không liên quan, điều gì khiến họ phải sửa hoặc tắt bộ nhớ. Không tự viết lời chứng thực.
- [ ] Xin phép trước khi đăng đoạn trò chuyện của người thử; che thông tin riêng. Ưu tiên một video ngắn hoặc ảnh có ngày, trạng thái lưu và nguồn.
- [ ] Thay đoạn “next step” trong article bằng kết quả thực tế khi đã có. Nếu chưa có, giữ nguyên giới hạn bằng chứng.
- [ ] Duyệt article 500–800 từ; nêu use case, luồng MemWal, before/after, sự cố, model/runtime và bằng chứng. Đăng trên Medium hoặc Inkray và lấy URL công khai.

Các bước thu bằng chứng cụ thể ở trên là kế hoạch đề xuất cho WalPen, không phải nguyên văn thể lệ.

## Chốt hồ sơ

- [ ] Hoàn tất đăng ký và trang dự án trên DeepSurge; điền tên, mô tả, liên hệ, GitHub.
- [ ] Chuẩn bị ví riêng cho Sessions; không dùng MemWalAccount object ID thay địa chỉ ví nhận thưởng.
- [ ] Kiểm tra agent ID, số blob Mainnet và link explorer; điền bằng chứng hiện tại.
- [ ] Tham gia Discord; điền feedback, URL demo, repo, article và model vào form.
- [ ] Chia sẻ article dưới thông báo session trên X, tag `@WalrusProtocol`, dùng `#WalrusMemory`; lưu link bài.
- [ ] Nếu tham gia promo, đăng ở cộng đồng phù hợp ngoài Walrus/Sui. Bài X không thay cho bài promo đủ điều kiện.
- [ ] Đọc điều kiện tham gia và điều khoản; hoàn tất một hồ sơ/person hoặc team trước 21:00 ngày 09/10/2026.
- [ ] Mở demo bằng phiên trình duyệt mới, kiểm tra đăng nhập/recall và đường dẫn công khai ngay trước khi nộp. Lưu xác nhận nộp để tránh gửi trùng.

## Những câu chưa được phép biến thành thành tích

- “Đã được sử dụng năm ngày”: hiện chỉ có năm trang giả lập mang năm ngày khác nhau.
- “Ba người dùng, mỗi người mười ký ức”: chưa có bằng chứng.
- “100% accuracy”: 5/5 fixture không phải đánh giá độ chính xác tổng quát.
- “Chỉ lưu đoạn được duyệt”: toàn bộ journal record được lưu; quyền duyệt giới hạn excerpt cho chatbot.
- “Thu hồi là xóa khỏi Walrus”: thu hồi ngăn sử dụng trong WalPen, không xóa blob cũ.
- “Hoàn toàn riêng tư/offline/E2EE”: relayer xử lý plaintext; API local đọc được cache.
- “PR #885 do WalPen triển khai trên relayer”: chỉ xác minh mã build hosted đã chứa fix; runtime còn phụ thuộc cấu hình của dịch vụ.
