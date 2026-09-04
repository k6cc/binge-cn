import i18n, { type PostProcessorModule } from "i18next";
import { initReactI18next } from "react-i18next";
import zh from "./locales/zh";
import en from "./locales/en";
import { activeSourceDisplayName, getActiveSource } from "../api/source";

const savedLanguage = localStorage.getItem("binge.language") || "zh";

// 源名动态化：locale 文案统一写 "StashDB"，全局 postProcessor 在每次
// t() 后把 "StashDB" 替换为活动数据源展示名（默认源仍为 "StashDB"，
// 其余实例为 host，如 "javstash.org"）。这样 25+ 处带源名的文案
// （"在 StashDB 上查看"、"StashDB 档案"…）无需逐个传 interpolation，
// 新增文案也只要照常写 "StashDB" 即可。
const sourceNamePostProcessor: PostProcessorModule = {
    type: "postProcessor",
    name: "sourceName",
    process: (value) =>
        typeof value === "string"
            ? value.replaceAll("StashDB", activeSourceDisplayName())
            : value,
};

i18n.use(sourceNamePostProcessor).use(initReactI18next).init({
    resources: {
        zh,
        en,
    },
    lng: savedLanguage,
    fallbackLng: "zh",
    postProcess: ["sourceName"],
    interpolation: {
        escapeValue: false, // React 已经处理了防 XSS
    },
});

i18n.on("languageChanged", (lng) => {
    localStorage.setItem("binge.language", lng);
});

// 尽早解析活动源（与各组件的 getActiveSource 共享会话 memo），不阻塞
// 首屏渲染——启动 splash 至少 600ms，本地配置查询通常在 splash 期间
// 完成。若解析出非默认源名，emit languageChanged 让所有 useTranslation
// 组件重渲染换名（react-i18next 以该事件驱动重渲染；默认源名不变则
// 无需重渲染）。失败静默：显示名保持 "StashDB"，与默认行为一致。
void getActiveSource()
    .then(() => {
        if (activeSourceDisplayName() !== "StashDB") {
            i18n.emit("languageChanged", i18n.language);
        }
    })
    .catch(() => {});

export default i18n;
