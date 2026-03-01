import { useState, useEffect, useRef, useCallback } from 'react';
import type { JSX } from 'react';
import type { VTSettings } from '@/pure/settings/types';
import { SettingsSection } from './SettingsSection';
import { AdvancedSettingsTab } from './AdvancedSettingsTab';
import { SECTIONS, type Section } from './settingsRegistry';

interface SettingsEditorProps {
    initialSettings: VTSettings;
    onSave: (settings: VTSettings) => Promise<void>;
}

const DEBOUNCE_MS: number = 300;

export function SettingsEditor({ initialSettings, onSave }: SettingsEditorProps): JSX.Element {
    const [settings, setSettings] = useState<VTSettings>(initialSettings);
    const [activeTab, setActiveTab] = useState<Section>('general');
    const [jsonError, setJsonError] = useState<string | null>(null);
    const debounceRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null> = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isFirstRender: React.MutableRefObject<boolean> = useRef<boolean>(true);

    // Debounced auto-save on settings change
    useEffect(() => {
        // Skip the initial render (don't save on mount)
        if (isFirstRender.current) {
            isFirstRender.current = false;
            return;
        }

        if (debounceRef.current !== null) {
            clearTimeout(debounceRef.current);
        }

        debounceRef.current = setTimeout(() => {
            void onSave(settings);
        }, DEBOUNCE_MS);

        return () => {
            if (debounceRef.current !== null) {
                clearTimeout(debounceRef.current);
            }
        };
    }, [settings, onSave]);

    const updateSetting: (key: string, value: unknown) => void = useCallback((key: string, value: unknown): void => {
        setJsonError(null);
        setSettings(prev => ({ ...prev, [key]: value }));
    }, []);

    const handleJsonUpdate: (jsonString: string) => void = useCallback((jsonString: string): void => {
        try {
            const parsed: VTSettings = JSON.parse(jsonString) as VTSettings;
            setJsonError(null);
            setSettings(parsed);
        } catch (error) {
            setJsonError((error as Error).message);
        }
    }, []);

    return (
        <div className="flex flex-col h-full font-mono text-sm text-foreground bg-background">
            {/* Tab bar */}
            <div className="flex border-b border-border px-4 shrink-0">
                {SECTIONS.map(tab => (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id)}
                        className={`px-3 py-2 text-sm font-mono transition-colors ${
                            activeTab === tab.id
                                ? 'border-b-2 border-foreground text-foreground font-medium'
                                : 'text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Content area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {activeTab === 'advanced' ? (
                    <AdvancedSettingsTab
                        settings={settings}
                        onUpdate={handleJsonUpdate}
                        error={jsonError}
                    />
                ) : (
                    <SettingsSection
                        settings={settings}
                        section={activeTab}
                        onUpdate={updateSetting}
                    />
                )}
            </div>
        </div>
    );
}
