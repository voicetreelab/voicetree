import posthog from "posthog-js";
import type {VTSettings} from "@/pure/settings/types";
// Import ElectronAPI type for window.electronAPI access
import type {} from "@/shell/electron";

const FEEDBACK_DELTA_THRESHOLD: number = 45;
const EMAIL_DELTA_THRESHOLD: number = 500;

// Session-level state for tracking total nodes created
let sessionDeltaCount: number = 0;
let feedbackAlertShown: boolean = false;
let emailPromptShown: boolean = false;
// Cache loaded email to avoid repeated IPC calls during session
let cachedUserEmail: string | null = null;

/**
 * Shows the feedback dialog and captures feedback to PostHog.
 * Use this for manual feedback collection (e.g., from speed dial menu).
 */
export async function collectFeedback(): Promise<void> {
    const feedback: string | null = await showFeedbackDialog();
    if (feedback) {
        posthog.capture('userFeedback', {
            feedback,
            source: 'manual-speed-dial'
        });
    }
}

/**
 * Creates and shows an HTML dialog for collecting user feedback.
 * Returns a promise that resolves with the feedback text or null if cancelled.
 * For internal use - prefer collectFeedback() for manual feedback collection.
 */
export function showFeedbackDialog(): Promise<string | null> {
    return new Promise((resolve) => {
        const dialog: HTMLDialogElement = document.createElement('dialog');
        dialog.id = 'feedback-dialog';
        dialog.style.cssText = `
            border: 1px solid var(--border);
            border-radius: var(--radius);
            background: var(--background);
            color: var(--foreground);
            padding: 24px;
            max-width: 420px;
            width: 90%;
            box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            margin: 0;
        `;

        dialog.innerHTML = `
            <form method="dialog" style="display: flex; flex-direction: column; gap: 16px;">
                <h2 style="margin: 0; font-size: 1.1rem; font-weight: 600;">
                    Hey I'm Manu who built this 
                </h2>
                <p style="margin: 0; color: var(--muted-foreground); font-size: 0.9rem;">
                    Voicetree is currently very early beta, so my priority is to get feedback so I can learn what to build to make Voicetree something that's extremely useful for you.
                    If you have any suggestions or critique, even just a sentence would be really useful. (You can also email me at founder@voicetree.io) 
                    Thanks!
                </p>
                <textarea
                    id="feedback-input"
                    rows="4"
                    placeholder="Type your feedback here..."
                    data-ph-unmask
                    style="
                        width: 100%;
                        padding: 10px 12px;
                        border: 1px solid var(--border);
                        border-radius: calc(var(--radius) - 2px);
                        background: var(--input);
                        color: var(--foreground);
                        font-family: inherit;
                        font-size: 0.9rem;
                        resize: vertical;
                        box-sizing: border-box;
                    "
                ></textarea>
                <div style="display: flex; gap: 8px; justify-content: flex-end;">
                    <button
                        type="button"
                        id="feedback-skip"
                        style="
                            padding: 8px 16px;
                            border: 1px solid var(--border);
                            border-radius: calc(var(--radius) - 2px);
                            background: transparent;
                            color: var(--muted-foreground);
                            cursor: pointer;
                            font-size: 0.9rem;
                        "
                    >Skip</button>
                    <button
                        type="submit"
                        id="feedback-submit"
                        disabled
                        style="
                            padding: 8px 16px;
                            border: none;
                            border-radius: calc(var(--radius) - 2px);
                            background: var(--primary);
                            color: var(--primary-foreground);
                            cursor: not-allowed;
                            font-size: 0.9rem;
                            opacity: 0.5;
                        "
                    >Send Feedback</button>
                </div>
            </form>
        `;

        document.body.appendChild(dialog);

        const textarea: HTMLTextAreaElement = dialog.querySelector('#feedback-input')!;
        const submitBtn: HTMLButtonElement = dialog.querySelector('#feedback-submit')!;
        const skipBtn: HTMLButtonElement = dialog.querySelector('#feedback-skip')!;

        // Track if promise has been settled to avoid double resolution
        let settled: boolean = false;
        const settle = (value: string | null): void => {
            if (!settled) {
                settled = true;
                resolve(value);
            }
        };

        // Enable submit button only when there's content
        textarea.addEventListener('input', () => {
            const hasContent: boolean = textarea.value.trim().length > 0;
            submitBtn.disabled = !hasContent;
            submitBtn.style.opacity = hasContent ? '1' : '0.5';
            submitBtn.style.cursor = hasContent ? 'pointer' : 'not-allowed';
        });

        dialog.addEventListener('close', () => {
            // Ensure promise resolves even if dialog is closed by ESC or other means
            settle(null);
            dialog.remove();
        });

        dialog.addEventListener('submit', (e: Event) => {
            e.preventDefault();
            const feedback: string = textarea.value.trim();
            settle(feedback || null);
            dialog.close();
        });

        skipBtn.addEventListener('click', () => {
            settle(null);
            dialog.close();
        });

        dialog.showModal();
        textarea.focus();
    });
}

/**
 * Simple email validation using regex.
 * Checks for basic email format: something@something.something
 */
function isValidEmail(email: string): boolean {
    const emailRegex: RegExp = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

/**
 * Creates and shows an HTML dialog for collecting user email.
 * Returns a promise that resolves with the email or null if cancelled.
 */
function showEmailDialog(): Promise<string | null> {
    return new Promise((resolve) => {
        const dialog: HTMLDialogElement = document.createElement('dialog');
        dialog.id = 'email-dialog';
        dialog.style.cssText = `
            border: 1px solid var(--border);
            border-radius: var(--radius);
            background: var(--background);
            color: var(--foreground);
            padding: 24px;
            max-width: 420px;
            width: 90%;
            box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            margin: 0;
        `;

        dialog.innerHTML = `
            <form method="dialog" style="display: flex; flex-direction: column; gap: 16px;">
                <h2 style="margin: 0; font-size: 1.1rem; font-weight: 600;">
                    Stay in the loop
                </h2>
                <p style="margin: 0; color: var(--muted-foreground); font-size: 0.9rem;">
                    I'll email you about early access for major updates and ask for feedback.
                </p>
                <input
                    type="email"
                    id="email-input"
                    placeholder="your@email.com"
                    style="
                        width: 100%;
                        padding: 10px 12px;
                        border: 1px solid var(--border);
                        border-radius: calc(var(--radius) - 2px);
                        background: var(--input);
                        color: var(--foreground);
                        font-family: inherit;
                        font-size: 0.9rem;
                        box-sizing: border-box;
                    "
                />
                <p id="email-error" style="margin: 0; color: #ef4444; font-size: 0.8rem; display: none;">
                    Please enter a valid email address
                </p>
                <div style="display: flex; gap: 8px; justify-content: flex-end;">
                    <button
                        type="button"
                        id="email-skip"
                        style="
                            padding: 8px 16px;
                            border: 1px solid var(--border);
                            border-radius: calc(var(--radius) - 2px);
                            background: transparent;
                            color: var(--muted-foreground);
                            cursor: pointer;
                            font-size: 0.9rem;
                        "
                    >Skip</button>
                    <button
                        type="submit"
                        id="email-submit"
                        disabled
                        style="
                            padding: 8px 16px;
                            border: none;
                            border-radius: calc(var(--radius) - 2px);
                            background: var(--primary);
                            color: var(--primary-foreground);
                            cursor: not-allowed;
                            font-size: 0.9rem;
                            opacity: 0.5;
                        "
                    >Submit</button>
                </div>
            </form>
        `;

        document.body.appendChild(dialog);

        const input: HTMLInputElement = dialog.querySelector('#email-input')!;
        const submitBtn: HTMLButtonElement = dialog.querySelector('#email-submit')!;
        const skipBtn: HTMLButtonElement = dialog.querySelector('#email-skip')!;
        const errorText: HTMLParagraphElement = dialog.querySelector('#email-error')!;

        // Enable submit button only when there's valid email content
        input.addEventListener('input', () => {
            const value: string = input.value.trim();
            const valid: boolean = isValidEmail(value);
            submitBtn.disabled = !valid;
            submitBtn.style.opacity = valid ? '1' : '0.5';
            submitBtn.style.cursor = valid ? 'pointer' : 'not-allowed';
            errorText.style.display = 'none';
        });

        dialog.addEventListener('close', () => {
            dialog.remove();
        });

        dialog.addEventListener('submit', (e: Event) => {
            e.preventDefault();
            const email: string = input.value.trim();
            if (isValidEmail(email)) {
                dialog.close();
                resolve(email);
            } else {
                errorText.style.display = 'block';
            }
        });

        skipBtn.addEventListener('click', () => {
            dialog.close();
            resolve(null);
        });

        dialog.showModal();
        input.focus();
    });
}

/**
 * Show email collection dialog after user creates enough nodes in a session.
 * Collects user email, saves to settings.json (via IPC), and uses email as PostHog identifier.
 * Only shows once per session and skips if email already saved.
 */
async function maybeShowEmailPrompt(): Promise<void> {
    if (emailPromptShown) return;

    // Skip if email already collected (cached or from settings)
    if (cachedUserEmail) return;

    // Check settings.json for existing email (only on first check)
    if (!window.electronAPI?.main?.loadSettings) return;
    const settings: VTSettings = await window.electronAPI.main.loadSettings() as VTSettings;
    if (settings.userEmail) {
        cachedUserEmail = settings.userEmail;
        return;
    }

    if (sessionDeltaCount >= EMAIL_DELTA_THRESHOLD) {
        emailPromptShown = true;
        const email: string | null = await showEmailDialog();
        if (email) {
            // Use email as PostHog distinct_id for consistent identity
            posthog.identify(email, { email });
            posthog.capture('emailCollected', {
                source: 'in-app-dialog',
                sessionDeltaCount
            });
            // Save to settings.json to persist across app updates/reinstalls
            const updatedSettings: VTSettings = { ...settings, userEmail: email };
            await window.electronAPI.main.saveSettings(updatedSettings);
            cachedUserEmail = email;
        }
    }
}

/**
 * Show feedback request dialog after user creates enough nodes in a session.
 * Collects user feedback and automatically sends it to PostHog.
 * Only shows once ever (persisted across sessions).
 */
async function maybeShowFeedbackAlert(): Promise<void> {
    if (feedbackAlertShown) return;

    sessionDeltaCount++;

    if (sessionDeltaCount >= FEEDBACK_DELTA_THRESHOLD) {
        feedbackAlertShown = true;

        // Check if feedback dialog has already been shown in a previous session
        if (!window.electronAPI?.main?.loadSettings) return;
        const settings: VTSettings = await window.electronAPI.main.loadSettings() as VTSettings;
        if (settings.feedbackDialogShown) return;

        // Mark as shown in settings before showing dialog
        const updatedSettings: VTSettings = { ...settings, feedbackDialogShown: true };
        await window.electronAPI.main.saveSettings(updatedSettings);

        const feedback: string | null = await showFeedbackDialog();
        if (feedback) {
            posthog.capture('userFeedback', {
                feedback,
                source: 'in-app-dialog',
                sessionDeltaCount
            });
        }
    }
}

/**
 * Check and show user engagement prompts (email collection, feedback) based on delta count.
 * Call this after new nodes are created in the graph.
 */
export function checkEngagementPrompts(): void {
    void maybeShowFeedbackAlert();
    void maybeShowEmailPrompt();
}
