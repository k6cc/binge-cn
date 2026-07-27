import type { Story as StoryData } from "./useStories";
import { useTranslation } from "react-i18next";

interface StoryProps {
    story: StoryData;
    onClick: (story: StoryData) => void;
}

// Single story circle — performer avatar wrapped in the IG-style gradient
// ring + name underneath. The ring is purely cosmetic for v0 (every story
// in the list has new content by construction); a "viewed" muted variant
// is a future addition.
export function Story({ story, onClick }: StoryProps) {
    const { t } = useTranslation();
    const { performerName, performerImagePath } = story;
    const newCount = story.scenes.length;
    return (
        <button
            type="button"
            className={
                "binge-story" +
                (story.performerFavorite ? " is-favorite" : "")
            }
            onClick={() => onClick(story)}
            title={t("story.new_scenes_title", "{{name}} — {{count}} 个新场景", { name: performerName, count: newCount })}
            aria-label={t("story.new_scenes_aria", "{{name}}，{{count}} 个新场景", { name: performerName, count: newCount })}
        >
            <span className="binge-story-ring">
                <span
                    className="binge-story-avatar"
                    style={
                        performerImagePath
                            ? {
                                  backgroundImage: `url(${performerImagePath})`,
                              }
                            : undefined
                    }
                >
                    {!performerImagePath && (
                        <span className="binge-story-initial">
                            {performerName.charAt(0).toUpperCase()}
                        </span>
                    )}
                </span>
            </span>
            <span className="binge-story-name">{performerName}</span>
        </button>
    );
}
