export type RecallReason =
  | "no_matches"
  | "authorization_rejected"
  | "invalid_distance"
  | "relevance_rejected"
  | "upstream_dropped"
  | "budget_omitted";

export interface RecallDiagnostics {
  status: "used" | "empty" | "disabled" | "unavailable" | "failed";
  maxDistance: number | null;
  returnedCount: number | null;
  // Upstream response fields, never interpreted as the namespace size.
  upstreamTotal: number | null;
  upstreamDropped: number | null;
  authorizationRejected: number;
  invalidDistance: number;
  relevanceRejected: number;
  duplicates: number;
  eligibleCount: number;
  budgetOmitted: number;
  usedCount: number;
  reasons: RecallReason[];
}

const notices = {
  empty: [
    "Không có ký ức phù hợp được đưa vào câu trả lời này. Điều đó không có nghĩa là bạn chưa lưu ký ức.",
    "No suitable memory was included in this answer. This does not mean you have no saved memories.",
  ],
  disabled: [
    "Bạn đã tắt dùng ký ức cho câu trả lời này.",
    "Memory is turned off for this answer.",
  ],
  unavailable: [
    "Chưa cấu hình bộ nhớ Walrus; câu trả lời này không dùng ký ức đã lưu.",
    "Walrus memory is not configured; this answer uses no saved memories.",
  ],
  failed: [
    "Chưa đọc được ký ức từ Walrus. Thử lại hoặc tắt “Dùng ký ức” để trò chuyện không có bộ nhớ.",
    "We couldn't retrieve memories from Walrus. Try again, or turn off “Use approved memories” to chat without memory.",
  ],
  no_matches: [
    "Lần tìm này không trả về ký ức nào.",
    "This search returned no memories.",
  ],
  authorization_rejected: [
    "Một số kết quả không khớp với ký ức hiện tại được bạn cho phép dùng.",
    "Some results did not match your current approved memories.",
  ],
  invalid_distance: [
    "Một số kết quả thiếu điểm độ liên quan hợp lệ nên không được dùng.",
    "Some results had no valid relevance score and were left out.",
  ],
  relevance_rejected: [
    "Một số kết quả chưa đủ liên quan đến câu hỏi này nên không được dùng.",
    "Some results were not relevant enough to this question and were left out.",
  ],
  upstream_dropped: [
    "Dịch vụ báo có kết quả không tải hoặc giải mã được; lần tìm này có thể chưa đầy đủ.",
    "The service reported results it could not download or decrypt; this search may be incomplete.",
  ],
  budget_omitted: [
    "Một số ký ức không vừa giới hạn ngữ cảnh. Nội dung đã lưu vẫn nguyên vẹn.",
    "Some memories did not fit the context limit. Your saved content is unchanged.",
  ],
} as const;

export function recallNotices(
  diagnostics: RecallDiagnostics,
  language: "vi" | "en",
) {
  const keys: (keyof typeof notices)[] = [];
  if (diagnostics.status !== "used") keys.push(diagnostics.status);
  // Explain exclusions for empty context; warn about partial retrieval even if usable hits remain.
  if (diagnostics.status === "empty") keys.push(...diagnostics.reasons);
  else if (
    diagnostics.status === "used" &&
    diagnostics.reasons.includes("upstream_dropped")
  )
    keys.push("upstream_dropped");
  return keys.map((key) => notices[key][language === "en" ? 1 : 0]);
}
