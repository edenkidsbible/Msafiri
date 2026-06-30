import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setupApiClient } from "./lib/auth";
import App from "./App";
import "./index.css";

setupApiClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
