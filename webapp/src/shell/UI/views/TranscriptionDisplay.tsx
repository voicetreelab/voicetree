import { useEffect, useLayoutEffect, useState } from "react";
import type { RefObject } from "react";
import type { Token } from "@soniox/speech-to-text-web";
import { subscribe, getDisplayTokens } from "@/shell/edge/UI-edge/state/TranscriptionStore";
import { getSpeakerColor } from "@/utils/speaker-colors";
import { getLanguage } from "@/utils/config/languages";

interface TranscriptionDisplayProps {
    scrollContainerRef: RefObject<HTMLDivElement | null>;
}

/**
 * React component for displaying transcription tokens.
 * Subscribes to TranscriptionStore and renders tokens with speaker/language labels.
 * Auto-scrolls when new tokens arrive.
 */
export function TranscriptionDisplay({ scrollContainerRef }: TranscriptionDisplayProps): React.ReactNode {
    const [tokens, setTokens] = useState<Token[]>([]);

    // Subscribe to TranscriptionStore
    useEffect(() => {
        const update = (): void => setTokens(getDisplayTokens());
        update(); // Initial load
        return subscribe(update);
    }, []);

    // Auto-scroll when token count increases
    useLayoutEffect(() => {
        const container = scrollContainerRef.current;
        if (container && tokens.length > 0) {
            container.scrollTop = container.scrollHeight;
        }
    }, [tokens.length, scrollContainerRef]);

    if (tokens.length === 0) {
        return null;
    }

    // Build rendered content with speaker/language tracking
    const elements: React.ReactNode[] = [];
    let lastSpeaker: string | undefined;
    let lastLanguage: string | undefined;

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];

        // Handle end token
        if (token.text === "<end>") {
            elements.push(
                <span key={`end-${i}`} className="text-muted-foreground italic text-xs">
                    {" <end>"}
                </span>
            );
            continue;
        }

        const isNewSpeaker = Boolean(token.speaker && token.speaker !== lastSpeaker);
        const isNewLanguage = Boolean(token.language && token.language !== lastLanguage);

        lastSpeaker = token.speaker;
        lastLanguage = token.language;

        // Speaker label
        if (isNewSpeaker && token.speaker) {
            elements.push(
                <div
                    key={`speaker-${i}`}
                    className="font-bold uppercase text-sm mt-2 block"
                    style={{ color: getSpeakerColor(token.speaker) }}
                >
                    Speaker {token.speaker}:
                </div>
            );
        }

        // New language line break (if not also new speaker)
        if (isNewLanguage && !isNewSpeaker) {
            elements.push(<br key={`br-${i}`} />);
        }

        // Language label
        if (isNewLanguage && token.language) {
            elements.push(
                <span
                    key={`lang-${i}`}
                    className="text-muted-foreground text-xs bg-muted px-2 py-0.5 rounded-full mr-1"
                >
                    {getLanguage(token.language).name}
                </span>
            );
        }

        // Token text
        elements.push(
            <span
                key={`token-${i}`}
                className={token.is_final ? "text-foreground font-medium" : "text-muted-foreground"}
            >
                {token.text}
            </span>
        );
    }

    return <div>{elements}</div>;
}
