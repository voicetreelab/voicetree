import posthog from "posthog-js";
import type {VTSettings} from "@/pure/settings/types";

const FEEDBACK_DELTA_THRESHOLD: number = 30;
const EMAIL_DELTA_THRESHOLD: number = 10;

// Session-level state for tracking total nodes created
let sessionDeltaCount: number = 0;
let feedbackAlertShown: boolean = false;
let emailPromptShown: boolean = false;
// Cache loaded email to avoid repeated IPC calls during session
let cachedUserEmail: string | null = null;

/**
 * Creates and shows an HTML dialog for collecting user feedback.
 * Returns a promise that resolves with the feedback text or null if cancelled.
 */
function showFeedbackDialog(): Promise<string | null> {
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
                    Hey I'm Manu who built this, glad to see you are using this!
                </h2>
                <p style="margin: 0; color: var(--muted-foreground); font-size: 0.9rem;">
                    It would mean a lot to me if you share any feedback. You can also email me at 1manumasson@gmail.com Hope Voicetree has been useful for you!
                </p>
                <textarea
                    id="feedback-input"
                    rows="4"
                    placeholder="Type your feedback here..."
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

        // Enable submit button only when there's content
        textarea.addEventListener('input', () => {
            const hasContent: boolean = textarea.value.trim().length > 0;
            submitBtn.disabled = !hasContent;
            submitBtn.style.opacity = hasContent ? '1' : '0.5';
            submitBtn.style.cursor = hasContent ? 'pointer' : 'not-allowed';
        });

        dialog.addEventListener('close', () => {
            dialog.remove();
        });

        dialog.addEventListener('submit', (e: Event) => {
            e.preventDefault();
            const feedback: string = textarea.value.trim();
            dialog.close();
            resolve(feedback || null);
        });

        // Prevent Escape key from closing dialog - user must submit or cancel
        dialog.addEventListener('cancel', (e: Event) => {
            e.preventDefault();
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
                <p style="margin: 0; color: var(--muted-foreground); font-size: 0.9rem;">
                    Enter your email to continue.
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
                    >Continue</button>
                </div>
            </form>
        `;

        document.body.appendChild(dialog);

        const input: HTMLInputElement = dialog.querySelector('#email-input')!;
        const submitBtn: HTMLButtonElement = dialog.querySelector('#email-submit')!;
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

        // Prevent Escape key from closing dialog - user must submit
        dialog.addEventListener('cancel', (e: Event) => {
            e.preventDefault();
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
    if (!window.electronAPI) return;
    const settings: VTSettings = await window.electronAPI.main.loadSettings() as VTSettings;
    if (settings.userEmail) {
        cachedUserEmail = settings.userEmail;
        return;
    }

    if (sessionDeltaCount >= EMAIL_DELTA_THRESHOLD) {
        emailPromptShown = true;
        const email: string | null = await showEmailDialog();
        if (email) {
            // Save to settings.json to persist across app updates/reinstalls
            const updatedSettings: VTSettings = { ...settings, userEmail: email };
            await window.electronAPI.main.saveSettings(updatedSettings);
            cachedUserEmail = email;
            // Use email as PostHog distinct_id for consistent identity
            posthog.identify(email, { email });
            posthog.capture('emailCollected', {
                source: 'in-app-dialog',
                sessionDeltaCount
            });
        }
    }
}

/**
 * Show feedback request dialog after user creates enough nodes in a session.
 * Collects user feedback and automatically sends it to PostHog.
 * Only shows once per session.
 */
function maybeShowFeedbackAlert(): void {
    if (feedbackAlertShown) return;

    sessionDeltaCount++;

    if (sessionDeltaCount >= FEEDBACK_DELTA_THRESHOLD) {
        feedbackAlertShown = true;
        void showFeedbackDialog().then((feedback: string | null) => {
            if (feedback) {
                posthog.capture('userFeedback', {
                    feedback,
                    source: 'in-app-dialog',
                    sessionDeltaCount
                });
            }
        });
    }
}

/**
 * Check and show user engagement prompts (email collection, feedback) based on delta count.
 * Call this after new nodes are created in the graph.
 */
export function checkEngagementPrompts(): void {
    maybeShowFeedbackAlert();
    void maybeShowEmailPrompt();
}
