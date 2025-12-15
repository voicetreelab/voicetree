import type { Token } from "@soniox/speech-to-text-web";
import { subscribe, getDisplayTokens, getDisplayTokenCount } from "@/shell/edge/UI-edge/state/TranscriptionStore";
import { getSpeakerColor } from "@/utils/speaker-colors";
import { getLanguage } from "@/utils/config/languages";

/**
 * Vanilla component for displaying transcription tokens.
 * Subscribes to TranscriptionStore and renders tokens with speaker/language labels.
 * Handles auto-scroll when new tokens arrive.
 */
export class TranscriptionDisplay {
    private container: HTMLElement;
    private unsubscribe: () => void;
    private prevTokenCount: number = 0;

    constructor(container: HTMLElement) {
        this.container = container;
        this.unsubscribe = subscribe(() => this.render());
        this.render();
    }

    private render(): void {
        const tokens: Token[] = getDisplayTokens();
        const count: number = getDisplayTokenCount();

        // Clear and rebuild content
        this.container.innerHTML = '';

        if (tokens.length === 0) {
            return;
        }

        const contentDiv: HTMLDivElement = document.createElement('div');
        let lastSpeaker: string | undefined;
        let lastLanguage: string | undefined;

        for (const token of tokens) {
            // Handle end token
            if (token.text === "<end>") {
                const endSpan: HTMLSpanElement = document.createElement('span');
                endSpan.className = 'text-gray-400 italic text-xs';
                endSpan.textContent = ' <end>';
                contentDiv.appendChild(endSpan);
                continue;
            }

            const isNewSpeaker: boolean = Boolean(token.speaker && token.speaker !== lastSpeaker);
            const isNewLanguage: boolean = Boolean(token.language && token.language !== lastLanguage);

            lastSpeaker = token.speaker;
            lastLanguage = token.language;

            // Speaker label
            if (isNewSpeaker && token.speaker) {
                const speakerLabel: HTMLDivElement = document.createElement('div');
                speakerLabel.className = 'font-bold uppercase text-sm mt-2 block';
                speakerLabel.style.color = getSpeakerColor(token.speaker);
                speakerLabel.textContent = `Speaker ${token.speaker}:`;
                contentDiv.appendChild(speakerLabel);
            }

            // New language line break (if not also new speaker)
            if (isNewLanguage && !isNewSpeaker) {
                contentDiv.appendChild(document.createElement('br'));
            }

            // Language label
            if (isNewLanguage && token.language) {
                const langLabel: HTMLSpanElement = document.createElement('span');
                langLabel.className = 'text-gray-500 text-xs bg-gray-200 px-2 py-0.5 rounded-full mr-1';
                langLabel.textContent = getLanguage(token.language).name;
                contentDiv.appendChild(langLabel);
            }

            // Token text
            const tokenSpan: HTMLSpanElement = document.createElement('span');
            tokenSpan.className = token.is_final ? 'text-black font-medium' : 'text-gray-600';
            tokenSpan.textContent = token.text;
            contentDiv.appendChild(tokenSpan);
        }

        this.container.appendChild(contentDiv);

        // Auto-scroll if new tokens arrived
        // Using 'instant' instead of 'smooth' because smooth scroll can fail
        // when the panel isn't focused/actively painted (browser throttles animations)
        if (count > this.prevTokenCount) {
            this.container.scrollTo({
                top: this.container.scrollHeight,
                behavior: 'instant'
            });
            this.prevTokenCount = count;
        }
    }

    dispose(): void {
        this.unsubscribe();
    }
}
