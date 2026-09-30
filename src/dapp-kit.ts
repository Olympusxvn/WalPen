import { createDAppKit } from "@mysten/dapp-kit-react";
import { SuiGrpcClient } from "@mysten/sui/grpc";

export const dAppKit = createDAppKit({
  networks: ["mainnet"],
  createClient: () =>
    new SuiGrpcClient({
      network: "mainnet",
      baseUrl: "https://fullnode.mainnet.sui.io:443",
    }),
  autoConnect: true,
});
declare module "@mysten/dapp-kit-react" {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}
