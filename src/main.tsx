import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { TranslatedErrorBoundary } from "./components/ErrorBoundary.tsx";
import "./i18n/config"; // 引入 i18n 配置
import "./styles/global.css";

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <TranslatedErrorBoundary>
            <App />
        </TranslatedErrorBoundary>
    </StrictMode>
);
