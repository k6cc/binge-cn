import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
    PERFORMER_SCENE_SORTS,
    type PerformerSceneSort,
} from "../api/queries";
import { SortMenu } from "../components/SortMenu";


// 详情页场景排序：通用 SortMenu + 场景排序选项的 i18n 标签映射。
export function PerformerSceneSortMenu({
    value,
    onChange,
}: {
    value: PerformerSceneSort;
    onChange: (next: PerformerSceneSort) => void;
}) {
    const { t } = useTranslation();

    const options = useMemo(
        () =>
            PERFORMER_SCENE_SORTS.map((s) => {
                // i18n 缺键时回退到查询层内置英文标签。
                let label = s.label;
                switch (s.key) {
                    case "recent":
                        label = t("sort.recent", s.label);
                        break;
                    case "views":
                        label = t("sort.views", s.label);
                        break;
                    case "orgasms":
                        label = t("sort.orgasms", s.label);
                        break;
                    case "rating":
                        label = t("sort.rating", s.label);
                        break;
                    case "added":
                        label = t("sort.added", s.label);
                        break;
                }
                return { value: s.key, label };
            }),
        [t],
    );

    return (
        <SortMenu
            options={options}
            value={value}
            onChange={onChange}
            ariaLabel={t("action.sort_scenes")}
        />
    );
}
