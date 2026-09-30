# Slush website warning — review request draft

Status: reported by the owner on 30 September 2026. The owner confirmed submitting a review request to Slush. No ticket number or response has been provided here. The warning has not been confirmed cleared, and its underlying detection reason is unknown. The draft below is retained as reference; submission was performed by the owner.

The supplied screenshot shows **Malicious website**, **Flag for review**, and alert ID `98be5c40-16d8-444e-890d-abfb7946e2c2`. It does not show the flagged URL; the owner encountered it while testing WalPen, so confirm the URL shown in the review form before submitting.

## Checks completed

- Public URL `https://walpen.vercel.app/` returned HTTP 200 without changing its final URL.
- Its entry script `/assets/index-DQmi92TY.js` matched the local production build byte for byte. SHA-256: `e20d6f0719b2754892c49283e072e6f302b01fc00faf9b7fcdefe889e30453bd`.
- The application's wallet flow in `src/WalletLogin.tsx` calls `signPersonalMessage`; no transaction-signing or transaction-execution call was found in application source under `src`, `server` or `api`.
- Server challenges include origin, wallet address, action, nonce and five-minute expiry. Verification checks the signature's address and consumes a browser-bound challenge once.
- The earlier production test used a synthetic Wallet Standard wallet. It verified application authentication, not Slush's security screening or every installed wallet extension.

These checks are limited evidence, not a security audit or proof of a false positive. Do not bypass the warning or change domains to evade it.

## Draft to paste into Flag for review / Slush support

Subject: Please investigate website warning for WalPen — alert 98be5c40-16d8-444e-890d-abfb7946e2c2

I maintain WalPen, an open-source journaling chatbot using Walrus Memory. Slush displays “Malicious website” while I test its Sui wallet login. Please investigate the detection and advise whether remediation is required or the classification should be corrected.

Website: https://walpen.vercel.app/

Repository: https://github.com/Olympusxvn/WalPen

Reviewed revision: https://github.com/Olympusxvn/WalPen/commit/52c6739

Alert ID: 98be5c40-16d8-444e-890d-abfb7946e2c2

The application requests a personal-message signature for authentication using Mysten dApp Kit. The server-generated message identifies WalPen, the origin, wallet, requested action, unique nonce and five-minute expiry. The application does not request a transfer, transaction signature, token approval, seed phrase or wallet private key. Signing establishes an application session; existing users can also link a wallet to their journal account.

The public entry script matches our local production build. We have not established the reason for this alert and are not asking users to bypass it. Please share any actionable detection details and review this exact URL.

Attach the warning screenshot. Confirm the affected URL and add Slush version, browser/device and whether the warning appeared at connection or signature approval. Do not include private keys, API keys, session cookies or signed login responses.

## Official contact

Use **Flag for review** in the warning first. Slush's official website also links to https://support.slush.app/ for support. Do not assume which security vendor issued this alert from the screenshot alone.
