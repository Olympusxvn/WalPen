# Dùng thử WalPen cùng bạn bè

Chỉ gửi link thử khi người vận hành đã xác nhận bản cloud hoạt động độc lập với máy cá nhân. Hiện theo dõi trạng thái tại [CLOUD-DEPLOYMENT.md](CLOUD-DEPLOYMENT.md).

## Tin nhắn mời — tác giả tự gửi

> Mình đang làm WalPen, một ứng dụng viết nhật ký và trò chuyện với bộ nhớ Walrus. Bạn có thể dùng thử trong vài ngày được không? Mỗi lần chỉ cần vài phút: lưu một điều muốn bot nhớ, rồi hôm sau mở cuộc trò chuyện mới để xem bot nhớ đúng và có giúp ích gì không. Dùng nội dung ít nhạy cảm; trang đã lưu được gửi lên Walrus. Bạn quyết định phần nào bot được dùng khi trả lời. Bản cloud cần khóa API Gemini/OpenAI của bạn trong Settings; nhà cung cấp có thể tính phí. Mình sẽ hỏi riêng trước khi trích bất kỳ nội dung hay nhận xét nào của bạn vào bài viết.

Kèm link https://walpen.vercel.app và mã mời do tác giả cung cấp. Không gửi khóa API hoặc khóa MemWal cho nhau.

## Lần đầu

1. Đăng ký tài khoản riêng; chọn EN hoặc VI.
2. Trong Settings, thêm khóa API cá nhân và model bạn có quyền dùng. Khóa nằm trong phiên tab; đăng xuất sẽ xóa khỏi phiên của WalPen.
3. Viết một trang với một chi tiết dễ kiểm chứng, ví dụ: “Mình thích đi bộ buổi sáng, nhưng tuần này chỉ có 15 phút.” Chọn rõ đoạn muốn bot nhớ và cho phép sử dụng đoạn đó.
4. Lưu, đợi trạng thái xác nhận trên Walrus. Nếu lỗi hoặc chưa xác định kết quả, ghi lại trạng thái; chưa tính là lưu thành công.
5. Mở cuộc trò chuyện mới, bật dùng ký ức và hỏi gợi ý phù hợp với thời gian/sở thích đã lưu. Kiểm tra nguồn và xem câu trả lời có dùng đúng chi tiết không.

## Quay lại qua vài ngày thực tế

- Đăng nhập cùng tài khoản và mở cuộc trò chuyện mới. Hỏi về kế hoạch hoặc sở thích đã lưu trước đó, rồi thử một câu hỏi cần dùng thông tin đó để đưa gợi ý phù hợp.
- Khi có thay đổi thật, sửa hoặc lưu phiên bản mới. Kiểm tra câu trả lời dùng thông tin hiện tại.
- Thử ngừng ghi nhớ một đoạn, mở cuộc trò chuyện mới và kiểm tra đoạn đó không còn được dùng. Thao tác này không xóa blob cũ khỏi Walrus.
- Nếu muốn đối chiếu, dùng cùng câu hỏi trong hai cuộc trò chuyện mới: một bật bộ nhớ, một tắt bộ nhớ. Giữ nguyên ngôn ngữ để dễ so sánh.

Không cần ép đủ số lần chat mỗi ngày. Ghi ngày thực tế; ngày gắn trong trang nhật ký không chứng minh ngày sử dụng.

## Ghi nhận riêng tư

Tác giả giữ bảng này ở nơi riêng tư, không commit dữ liệu người thử vào repository. Chỉ ghi những gì đã quan sát hoặc được người thử xác nhận.

| Ngày/giờ thực tế | Mã người thử | Phiên mới? | Chi tiết cần nhớ | Trạng thái lưu/blob | Recall đúng? | Gợi ý có phù hợp cá nhân? | Lỗi hoặc phản hồi | Cho phép trích dẫn? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Điền sau khi dùng | T01 | Có/Không | Tóm tắt đã được đồng ý | Xác nhận/Chưa xác nhận | Đúng/Sai/Không có nguồn | Có/Không + lý do | Ghi nguyên ý | Có/Không |

Trước khi chốt article, tổng hợp số người thực sự đã dùng, các ngày sử dụng, một ví dụ thành công, một điểm chưa tốt và thay đổi đã làm từ phản hồi. Đánh dấu riêng dữ liệu mẫu, test tự động và trải nghiệm người thật. Không tạo lời chứng thực hoặc điền trước kết quả.
