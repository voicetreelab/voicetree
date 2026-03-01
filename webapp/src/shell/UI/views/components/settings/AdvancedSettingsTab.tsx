import { useState, useEffect } from 'react';
import type { JSX } from 'react';
import type { VTSettings } from '@/pure/settings/types';

interface AdvancedSettingsTabProps {
    settings: VTSettings;
    onUpdate: (jsonString: string) => void;
    error: string | null;
}

/**
 * Advanced settings tab - provides raw JSON editing for power users.
 *
 * This is the "escape hatch" for power users who need to edit settings
 * not yet exposed in the UI, or who prefer JSON editing.
 *
 * Features:
 * - Pretty-printed JSON editing
 * - Syntax validation with error display
 * - Non-destructive: unknown keys are preserved
 */
export function AdvancedSettingsTab({ settings, onUpdate, error }: AdvancedSettingsTabProps): JSX.Element {
    const [jsonValue, setJsonValue] = useState<string>('');
    const [isDirty, setIsDirty] = useState<boolean>(false);

    // Initialize JSON from settings when tab is opened/settings change externally
    useEffect(() => {
        // Only update if we haven't made local edits (to avoid cursor jumping)
        if (!isDirty) {
            setJsonValue(JSON.stringify(settings, null, 2));
        }
    }, [settings, isDirty]);

    const handleChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void = (e) => {
        const newValue: string = e.target.value;
        setJsonValue(newValue);
        setIsDirty(true);
        onUpdate(newValue);
    };

    const handleFormat: () => void = () => {
        try {
            const parsed: unknown = JSON.parse(jsonValue);
            const formatted: string = JSON.stringify(parsed, null, 2);
            setJsonValue(formatted);
            setIsDirty(false);
            onUpdate(formatted);
        } catch {
            // Invalid JSON, don't format
        }
    };

    return (
        <div className="space-y-4">
            {/* Header with info and format button */}
            <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                    <h3 className="font-mono text-sm font-medium text-foreground">Raw Settings JSON</h3>
                    <p className="text-xs text-muted-foreground max-w-lg">
                        Edit settings directly as JSON. All changes are validated before saving.
                        Unknown keys are preserved and will not be lost.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={handleFormat}
                    disabled={!!error}
                    className="px-3 py-1.5 text-xs font-mono bg-muted hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed rounded border border-border transition-colors"
                >
                    Format JSON
                </button>
            </div>

            {/* Error display */}
            {error && (
                <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-md">
                    <div className="flex items-center gap-2 text-destructive text-xs font-mono">
                        <span>⚠</span>
                        <span>JSON Error: {error}</span>
                    </div>
                </div>
            )}

            {/* JSON editor */}
            <div className="relative">
                <textarea
                    value={jsonValue}
                    onChange={handleChange}
                    spellCheck={false}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    className={`
                        w-full h-[400px] p-3
                        bg-input text-foreground
                        font-mono text-xs
                        border rounded-md resize-y
                        focus:outline-none focus:ring-2 focus:ring-ring
                        ${error ? 'border-destructive focus:ring-destructive' : 'border-border'}
                    `}
                />
                {isDirty && !error && (
                    <div className="absolute top-2 right-2 text-xs text-muted-foreground bg-background/80 px-2 py-1 rounded">
                        Unsaved changes
                    </div>
                )}
            </div>

            {/* Tips */}
            <div className="text-xs text-muted-foreground space-y-1">
                <p><strong>Tips:</strong></p>
                <ul className="list-disc list-inside space-y-0.5 ml-2">
                    <li>Use <code>Cmd/Ctrl + S</code> to trigger save (auto-saves on valid JSON)</li>
                    <li>Click &quot;Format JSON&quot; to pretty-print and validate</li>
                    <li>All unknown keys will be preserved even if not shown in other tabs</li>
                </ul>
            </div>
        </div>
    );
}
