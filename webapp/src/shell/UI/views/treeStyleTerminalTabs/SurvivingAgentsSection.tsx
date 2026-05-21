import {useCallback, useState} from 'react';
import type {JSX} from 'react';
import {Link2, RefreshCw, X} from 'lucide-react';
import type {UnclaimedTmuxSession} from '@vt/agent-runtime';

type SurvivingAgentActionResult = {
    readonly success: boolean;
    readonly error?: string;
};

type SurvivingAgentsSectionProps = {
    readonly sessions: readonly UnclaimedTmuxSession[];
    readonly onRefresh: () => Promise<void> | void;
    readonly onAttach: (sessionName: string) => Promise<SurvivingAgentActionResult>;
    readonly onKill: (sessionName: string) => Promise<SurvivingAgentActionResult>;
};

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function sessionTooltip(session: UnclaimedTmuxSession): string {
    const parts: string[] = [
        `tmux: ${session.sessionName}`,
        `terminal: ${session.terminalId}`,
        `pid: ${session.panePid}`,
    ];
    if (session.vaultPath) parts.push(`vault: ${session.vaultPath}`);
    if (session.contextNodePath) parts.push(`context: ${session.contextNodePath}`);
    if (session.taskNodePath) parts.push(`task: ${session.taskNodePath}`);
    return parts.join('\n');
}

export function SurvivingAgentsSection({
    sessions,
    onRefresh,
    onAttach,
    onKill,
}: SurvivingAgentsSectionProps): JSX.Element | null {
    const [busySessionName, setBusySessionName] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const handleRefresh: () => void = useCallback((): void => {
        setError(null);
        void Promise.resolve(onRefresh()).catch((err: unknown): void => {
            setError(errorMessage(err));
        });
    }, [onRefresh]);

    const runAction = useCallback((
        session: UnclaimedTmuxSession,
        action: (sessionName: string) => Promise<SurvivingAgentActionResult>,
    ): void => {
        setBusySessionName(session.sessionName);
        setError(null);
        void action(session.sessionName)
            .then((result: SurvivingAgentActionResult): void => {
                if (!result.success) {
                    setError(result.error ?? 'Action failed');
                }
            })
            .catch((err: unknown): void => {
                setError(errorMessage(err));
            })
            .finally((): void => {
                setBusySessionName(null);
            });
    }, []);

    if (sessions.length === 0 && !error) return null;

    return (
        <section className="surviving-agents-section" aria-label="Surviving agents" data-testid="surviving-agents-section">
            <div className="terminal-tree-header surviving-agents-header">
                <span>Surviving agents ({sessions.length})</span>
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
                {sessions.map((session: UnclaimedTmuxSession): JSX.Element => {
                    const isBusy: boolean = busySessionName === session.sessionName;
                    const isThisVault: boolean = session.classification === 'this-vault';
                    return (
                        <div
                            key={session.sessionName}
                            className="surviving-agent-row"
                            data-session-name={session.sessionName}
                            title={sessionTooltip(session)}
                        >
                            <div className="surviving-agent-main">
                                <div className="surviving-agent-title-row">
                                    <span className="surviving-agent-title">
                                        {session.agentName || session.terminalId}
                                    </span>
                                    <span className={`surviving-agent-badge ${isThisVault ? 'this-vault' : 'foreign-vault'}`}>
                                        {isThisVault ? 'This vault' : 'Foreign vault'}
                                    </span>
                                </div>
                                <div className="surviving-agent-meta">
                                    pid {session.panePid}
                                </div>
                            </div>

                            <div className="surviving-agent-actions">
                                {session.attachable && (
                                    <button
                                        className="surviving-agent-action attach"
                                        type="button"
                                        onClick={() => runAction(session, onAttach)}
                                        title="Attach surviving agent"
                                        disabled={isBusy}
                                    >
                                        <Link2 size={12} aria-hidden="true" />
                                        <span>Attach</span>
                                    </button>
                                )}
                                <button
                                    className="surviving-agent-action kill"
                                    type="button"
                                    onClick={() => runAction(session, onKill)}
                                    title="Kill surviving tmux session"
                                    aria-label={`Kill ${session.agentName || session.terminalId}`}
                                    disabled={isBusy}
                                >
                                    <X size={13} aria-hidden="true" />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
