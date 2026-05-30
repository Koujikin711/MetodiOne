import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import metodiMarkUrl from "@/assets/metodione-mark.svg?url";

import App from "./App";
import "./index.css";
import "leaflet/dist/leaflet.css";
import { initTheme } from "@/lib/themeMode";

initTheme();

function applyMetodiFavicons() {
  for (const rel of ["icon", "apple-touch-icon"] as const) {
    let el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
    if (!el) {
      el = document.createElement("link");
      el.rel = rel;
      document.head.appendChild(el);
    }
    el.type = "image/svg+xml";
    el.href = metodiMarkUrl;
  }
}
applyMetodiFavicons();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
