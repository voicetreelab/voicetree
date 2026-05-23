import {useCallback, useState} from 'react';
import type {JSX} from 'react';
import {Link2, Play, RefreshCw, X} from 'lucide-react';
import type {RecoverableAgentSession, UnclaimedTmuxSession} from '@vt/agent-runtime';

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

function attachableTooltip(session: UnclaimedTmuxSession): string {
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

function resumableTooltip(row: Extract<RecoverableAgentSession, {kind: 'resumable-cli'}>): string {
    const parts: string[] = [
        `cli: ${row.cliType}`,
        `terminal: ${row.terminalId}`,
        `native session: ${row.nativeSessionId}`,
        `metadata: ${row.metadataPath}`,
    ];
    const vaultPath: string | undefined = row.terminalData.initialEnvVars?.VOICETREE_VAULT_PATH;
    if (vaultPath) parts.push(`vault: ${vaultPath}`);
    if (row.terminalData.attachedToContextNodeId) parts.push(`context: ${row.terminalData.attachedToContextNodeId}`);
    return parts.join('\n');
}

function rowKey(row: RecoverableAgentSession): string {
    return row.kind === 'attachable-tmux'
        ? `attachable:${row.session.sessionName}`
        : `resumable:${row.terminalId}`;
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
                {sessions.map((row: RecoverableAgentSession): JSX.Element => {
                    const key: string = rowKey(row);
                    const isBusy: boolean = busyKey === key;
                    if (row.kind === 'attachable-tmux') {
                        const session: UnclaimedTmuxSession = row.session;
                        const isThisVault: boolean = session.classification === 'this-vault';
                        return (
                            <div
                                key={key}
                                className="surviving-agent-row"
                                data-session-name={session.sessionName}
                                data-row-kind="attachable-tmux"
                                title={attachableTooltip(session)}
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
                                        {formatAge(session.createdAt, now)} | pid {session.panePid}
                                    </div>
                                </div>
                                <div className="surviving-agent-actions">
                                    {session.attachable && (
                                        <button
                                            className="surviving-agent-action attach"
                                            type="button"
                                            onClick={() => runAction(key, () => onAttach(session.sessionName))}
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
                                        onClick={() => runAction(key, () => onKill(session.sessionName))}
                                        title="Kill surviving tmux session"
                                        aria-label={`Kill ${session.agentName || session.terminalId}`}
                                        disabled={isBusy}
                                    >
                                        <X size={13} aria-hidden="true" />
                                    </button>
                                </div>
                            </div>
                        );
                    }

                    // resumable-cli row: dead-pane Claude/Codex with deterministic native session id
                    return (
                        <div
                            key={key}
                            className="surviving-agent-row"
                            data-terminal-id={row.terminalId}
                            data-row-kind="resumable-cli"
                            title={resumableTooltip(row)}
                        >
                            <div className="surviving-agent-main">
                                <div className="surviving-agent-title-row">
                                    <span className="surviving-agent-title">
                                        {row.agentName || row.terminalId}
                                    </span>
                                    <span className="surviving-agent-badge resumable">
                                        Resumable ({row.cliType})
                                    </span>
                                </div>
                                <div className="surviving-agent-meta">
                                    session {row.nativeSessionId}
                                </div>
                            </div>
                            <div className="surviving-agent-actions">
                                <button
                                    className="surviving-agent-action resume"
                                    type="button"
                                    onClick={() => runAction(key, () => onResume(row.terminalId))}
                                    title={`Resume ${row.cliType} session`}
                                    aria-label={`Resume ${row.cliType} session`}
                                    disabled={isBusy}
                                >
                                    <Play size={12} aria-hidden="true" />
                                    <span>Resume</span>
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
