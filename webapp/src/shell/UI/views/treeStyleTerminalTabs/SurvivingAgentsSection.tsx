import {useCallback, useState} from 'react';
import type {JSX} from 'react';
import {Link2, Play, RefreshCw, X} from 'lucide-react';
import type {RecoverableAgentSession} from '@vt/vt-daemon-client';

type SurvivingAgentActionResult = {
    readonly success: boolean;
    readonly error?: string;
};

type SurvivingAgentsSectionProps = {
    readonly sessions: readonly RecoverableAgentSession[];
    readonly onRefresh: () => Promise<void> | void;
    readonly onAttach: (sessionName: string) => Promise<SurvivingAgentActionResult>;
    readonly onKill: (sessionName: string) => Promise<SurvivingAgentActionResult>;
    readonly onResume: (terminalId: string) => Promise<SurvivingAgentActionResult>;
};

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function formatAge(createdAt: number, now: number): string {
    const ageSeconds: number = Math.max(0, Math.floor((now - createdAt) / 1000));
    if (ageSeconds < 60) return `${ageSeconds}s ago`;

    const ageMinutes: number = Math.floor(ageSeconds / 60);
    if (ageMinutes < 60) return `${ageMinutes}m ago`;

    const ageHours: number = Math.floor(ageMinutes / 60);
    if (ageHours < 24) return `${ageHours}h ago`;

    return `${Math.floor(ageHours / 24)}d ago`;
}

function rowTooltip(row: RecoverableAgentSession): string {
    const parts: string[] = [`terminal: ${row.terminalId}`];
    if (row.attach) {
        parts.push(`tmux: ${row.attach.session.sessionName}`);
        parts.push(`pid: ${row.attach.session.panePid}`);
    }
    if (row.resume) {
        parts.push(`resume cli: ${row.resume.cliType}`);
    }
    if (row.metadataPath) parts.push(`metadata: ${row.metadataPath}`);
    const projectRoot: string | undefined = row.terminalData.initialEnvVars?.VOICETREE_VAULT_PATH;
    if (projectRoot) parts.push(`project root: ${projectRoot}`);
    return parts.join('\n');
}

function rowMeta(row: RecoverableAgentSession, now: number): string {
    if (row.attach) {
        return `${formatAge(row.attach.session.createdAt, now)} | pid ${row.attach.session.panePid}`;
    }
    return '';
}

function rowBadge(row: RecoverableAgentSession): {label: string; className: string} {
    if (row.attach) {
        const isThisVault: boolean = row.attach.session.classification === 'this-vault';
        return {
            label: isThisVault ? 'This vault' : 'Foreign vault',
            className: isThisVault ? 'this-vault' : 'foreign-vault',
        };
    }
    if (row.resume) {
        return {label: `Resumable (${row.resume.cliType})`, className: 'resumable'};
    }
    return {label: 'Surviving', className: 'this-vault'};
}

export function SurvivingAgentsSection({
    sessions,
    onRefresh,
    onAttach,
    onKill,
    onResume,
}: SurvivingAgentsSectionProps): JSX.Element | null {
    const [busyKey, setBusyKey] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const now: number = Date.now();

    const handleRefresh: () => void = useCallback((): void => {
        setError(null);
        void Promise.resolve(onRefresh()).catch((err: unknown): void => {
            setError(errorMessage(err));
        });
    }, [onRefresh]);

    const runAction = useCallback((
        key: string,
        action: () => Promise<SurvivingAgentActionResult>,
    ): void => {
        setBusyKey(key);
        setError(null);
        void action()
            .then((result: SurvivingAgentActionResult): void => {
                if (!result.success) {
                    setError(result.error ?? 'Action failed');
                }
            })
            .catch((err: unknown): void => {
                setError(errorMessage(err));
            })
            .finally((): void => {
                setBusyKey(null);
            });
    }, []);

    // Surviving Agents shows only unclaimed rows. Claimed rows (live tabs with
    // a resume handle) get a fork-on-hover button on the regular tab strip.
    const unclaimedSessions: readonly RecoverableAgentSession[] = sessions.filter((s) => !s.isClaimed);

    if (unclaimedSessions.length === 0 && !error) return null;

    return (
        <section className="surviving-agents-section" aria-label="Surviving agents" data-testid="surviving-agents-section">
            <div className="terminal-tree-header surviving-agents-header">
                <span>Surviving agents ({unclaimedSessions.length})</span>
                <button
                    className="surviving-agents-refresh"
                    type="button"
                    onClick={handleRefresh}
                    title="Refresh surviving agents"
                    aria-label="Refresh surviving agents"
                >
                    <RefreshCw size={13} aria-hidden="true" />
                </button>
            </div>

            {error && (
                <div className="surviving-agents-error" role="status">
                    {error}
                </div>
            )}

            <div className="surviving-agents-list">
                {unclaimedSessions.map((row: RecoverableAgentSession): JSX.Element => {
                    const key: string = row.terminalId;
                    const isBusy: boolean = busyKey === key;
                    const badge: {label: string; className: string} = rowBadge(row);
                    return (
                        <div
                            key={key}
                            className="surviving-agent-row"
                            data-terminal-id={row.terminalId}
                            data-has-attach={row.attach ? 'true' : 'false'}
                            data-has-resume={row.resume ? 'true' : 'false'}
                            data-session-name={row.attach?.session.sessionName}
                            title={rowTooltip(row)}
                        >
                            <div className="surviving-agent-main">
                                <div className="surviving-agent-title-row">
                                    <span className="surviving-agent-title">
                                        {row.agentName || row.terminalId}
                                    </span>
                                    <span className={`surviving-agent-badge ${badge.className}`}>
                                        {badge.label}
                                    </span>
                                </div>
                                <div className="surviving-agent-meta">{rowMeta(row, now)}</div>
                            </div>
                            <div className="surviving-agent-actions">
                                {row.attach && row.attach.session.attachable && (
                                    <button
                                        className="surviving-agent-action attach"
                                        type="button"
                                        onClick={() => runAction(key, () => onAttach(row.attach!.session.sessionName))}
                                        title="Attach surviving agent"
                                        disabled={isBusy}
                                    >
                                        <Link2 size={12} aria-hidden="true" />
                                        <span>Attach</span>
                                    </button>
                                )}
                                {row.resume && (
                                    <button
                                        className="surviving-agent-action resume"
                                        type="button"
                                        onClick={() => runAction(key, () => onResume(row.terminalId))}
                                        title={`Resume ${row.resume.cliType} session`}
                                        aria-label={`Resume ${row.resume.cliType} session`}
                                        disabled={isBusy}
                                    >
                                        <Play size={12} aria-hidden="true" />
                                        <span>Resume</span>
                                    </button>
                                )}
                                {row.attach && (
                                    <button
                                        className="surviving-agent-action kill"
                                        type="button"
                                        onClick={() => runAction(key, () => onKill(row.attach!.session.sessionName))}
                                        title="Kill surviving tmux session"
                                        aria-label={`Kill ${row.agentName || row.terminalId}`}
                                        disabled={isBusy}
                                    >
                                        <X size={13} aria-hidden="true" />
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
