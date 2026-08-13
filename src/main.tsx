import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { TranslatedErrorBoundary } from "./components/ErrorBoundary.tsx";
import "./i18n/config";
import "./styles/global.css";

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <TranslatedErrorBoundary>
            <App />
        </TranslatedErrorBoundary>
    </StrictMode>
);
