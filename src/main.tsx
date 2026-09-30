import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";
import { DAppKitProvider } from "@mysten/dapp-kit-react";
import { dAppKit } from "./dapp-kit";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DAppKitProvider dAppKit={dAppKit}>
      <App />
    </DAppKitProvider>
  </React.StrictMode>,
);
