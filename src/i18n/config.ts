import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zh from "./locales/zh";
import en from "./locales/en";

const savedLanguage = localStorage.getItem("binge.language") || "zh";

i18n.use(initReactI18next).init({
    resources: {
        zh,
        en,
    },
    lng: savedLanguage,
    fallbackLng: "zh",
    interpolation: {
        escapeValue: false, // React 已经处理了防 XSS
    },
});

i18n.on("languageChanged", (lng) => {
    localStorage.setItem("binge.language", lng);
});

export default i18n;
