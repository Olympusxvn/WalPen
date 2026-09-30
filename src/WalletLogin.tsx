import { useState } from "react";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { ConnectButton } from "@mysten/dapp-kit-react/ui";

export function WalletLogin({
  language,
  inviteRequired,
  link = false,
  onSuccess,
}: {
  language: "en" | "vi";
  inviteRequired: boolean;
  link?: boolean;
  onSuccess: (user: {
    id: string;
    username: string;
    walletAddress: string;
  }) => void;
}) {
  const en = language === "en",
    account = useCurrentAccount(),
    kit = useDAppKit();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [invite, setInvite] = useState("");
  async function post(path: string, body: unknown) {
    const response = await fetch("/api/wallet/" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Wallet sign-in failed.");
    return result;
  }
  async function signIn() {
    if (!account || busy) return;
    setBusy(true);
    setError("");
    try {
      const challenge = await post("challenge", {
        address: account.address,
        link,
      });
      const signed = await kit.signPersonalMessage({
        message: new TextEncoder().encode(challenge.message),
        account,
      });
      const result = await post("verify", {
        challengeId: challenge.challengeId,
        signature: signed.signature,
        inviteCode: invite || undefined,
      });
      onSuccess(result.user);
    } catch (error: any) {
      setError(
        error.message ||
          (en
            ? "Signature cancelled. Try again when ready."
            : "Đã hủy ký. Bạn có thể thử lại."),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="wallet-login">
      <h3>
        {link
          ? en
            ? "Link your Sui wallet"
            : "Liên kết ví Sui"
          : "Connect Sui wallet → approve signature"}
      </h3>
      <p className="small">
        {en
          ? "Connect your wallet, then approve a personal sign-in message. No transaction or gas fee is requested."
          : "Kết nối ví, rồi duyệt chữ ký thông điệp đăng nhập. Không gửi giao dịch hay yêu cầu phí gas."}
      </p>
      <ConnectButton />
      {inviteRequired && !link && (
        <label className="wallet-invite">
          {en ? "Invitation code (first visit only)" : "Mã mời (chỉ lần đầu)"}
          <input
            value={invite}
            onChange={(event) => setInvite(event.target.value)}
            autoComplete="off"
          />
        </label>
      )}
      <button
        className="primary full"
        disabled={!account || busy}
        onClick={() => void signIn()}
      >
        {busy
          ? en
            ? "Waiting for signature…"
            : "Đang chờ chữ ký…"
          : link
            ? en
              ? "Approve signature & link"
              : "Ký xác nhận & liên kết"
            : en
              ? "Approve signature & sign in"
              : "Ký xác nhận & đăng nhập"}
      </button>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
