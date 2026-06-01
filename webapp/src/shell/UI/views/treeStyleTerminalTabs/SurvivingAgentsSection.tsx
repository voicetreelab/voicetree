import {useCallback, useState} from 'react';
import type {JSX, ReactNode} from 'react';
import {ClipboardCopy, GitBranch, Link2, Play, RefreshCw, X} from 'lucide-react';
import type {RecoverableAgentSession, ResumePersistedResult} from '@vt/vt-daemon-client';

type SurvivingAgentActionResult = {
    readonly success: boolean;
    readonly error?: string;
};

type NoNativeSessionResult = Extract<ResumePersistedResult, {readonly kind: 'no-native-session'}>;

export type SurvivingAgentResumeFailure = {
    readonly reason: NoNativeSessionResult['reason'];
    readonly cliType: NoNativeSessionResult['cliType'];
    readonly diagnosticSessionId?: string;
};

export type SurvivingAgentResumeResult = SurvivingAgentActionResult & {
    readonly failure?: SurvivingAgentResumeFailure;
};

/**
 * `onRefresh` accepts an optional `horizonDays`:
 * - undefined → server-side default (7 days).
 * - null → disable the cutoff ("Show older" link).
 * - number → explicit day window.
 *
 * `renderRowActions` is an extension slot for actions that aren't part of the
 * core Attach/Resume/Kill set (e.g. the per-row trash button owned by §7).
 * Keep the contract narrow so future workers can extend rendering without
 * patching this file again.
 *
 * `onResume` may return `failure` carrying a structured resolver-miss reason
 * (§8). When set, the section renders the mapped plain-language message and
 * (for `outside-recency-window` with a `diagnosticSessionId`) a copy-manual-
 * resume-command button.
 */
type SurvivingAgentsSectionProps = {
    readonly sessions: readonly RecoverableAgentSession[];
    readonly onRefresh: (horizonDays?: number | null) => Promise<void> | void;
    readonly onAttach: (sessionName: string) => Promise<SurvivingAgentActionResult>;
    readonly onKill: (sessionName: string) => Promise<SurvivingAgentActionResult>;
    readonly onResume: (terminalId: string) => Promise<SurvivingAgentResumeResult>;
    readonly renderRowActions?: (row: RecoverableAgentSession) => ReactNode;
};

const RESUME_FAILURE_MESSAGES: Record<NoNativeSessionResult['reason'], string> = {
    'db-missing': 'Codex state database not found at ~/.codex/state_5.sqlite',
    'db-schema-mismatch': "Codex state DB schema is unexpected — voicetree can't read it",
    'outside-recency-window': "Session exists but is older than the resolver's recency window",
    'marker-mismatch': 'No matching session — likely the project was moved or the task node renamed since spawn',
    'no-rows': 'No Codex threads recorded for this project',
    'projects-dir-missing': 'Claude projects directory not found at ~/.claude/projects',
    'no-jsonl-matches': 'No Claude transcripts matched this project/cwd',
    'scan-timeout': 'Claude transcript scan timed out — try again or widen the timeout',
};

function manualResumeCommand(failure: SurvivingAgentResumeFailure): string | null {
    if (failure.reason !== 'outside-recency-window') return null;
    if (!failure.diagnosticSessionId) return null;
    return failure.cliType === 'codex'
        ? `codex resume ${failure.diagnosticSessionId}`
        : `claude --resume ${failure.diagnosticSessionId}`;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function recoverableAgentRowKey(row: RecoverableAgentSession): string {
    return row.attach?.session.sessionName
        ?? row.metadataPath
        ?? `${row.terminalId}:${row.status}:${row.startedAt ?? row.closedAt ?? row.endedAt ?? ''}`;
}

function formatAge(timestampMs: number, now: number): string {
    const ageSeconds: number = Math.max(0, Math.floor((now - timestampMs) / 1000));
    if (ageSeconds < 60) return `${ageSeconds}s ago`;

    const ageMinutes: number = Math.floor(ageSeconds / 60);
    if (ageMinutes < 60) return `${ageMinutes}m ago`;

    const ageHours: number = Math.floor(ageMinutes / 60);
    if (ageHours < 24) return `${ageHours}h ago`;

    return `${Math.floor(ageHours / 24)}d ago`;
}

function isoToMs(iso: string | undefined): number {
    if (!iso) return 0;
    const parsed: number = Date.parse(iso);
    return Number.isFinite(parsed) ? parsed : 0;
}

function firstNonEmpty(...candidates: ReadonlyArray<string | undefined>): string | undefined {
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.length > 0) return candidate;
    }
    return undefined;
}

function displayTitle(row: RecoverableAgentSession): string {
    return firstNonEmpty(row.title, row.terminalData.title, row.agentName) ?? row.terminalId;
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
    if (row.status !== 'running') {
        parts.push(`status: ${row.status}`);
        if (row.killReason) parts.push(`kill reason: ${row.killReason}`);
        if (row.endedAt) parts.push(`ended: ${row.endedAt}`);
    }
    if (row.metadataPath) parts.push(`metadata: ${row.metadataPath}`);
    const projectRoot: string | undefined = row.terminalData.initialEnvVars?.VOICETREE_PROJECT_PATH;
    if (projectRoot) parts.push(`project root: ${projectRoot}`);
    return parts.join('\n');
}

function rowMeta(row: RecoverableAgentSession, now: number): string {
    if (row.attach) {
        return `${formatAge(row.attach.session.createdAt, now)} | pid ${row.attach.session.panePid}`;
    }
    if (row.status !== 'running') {
        const endedMs: number = row.closedAt ?? isoToMs(row.endedAt);
        if (endedMs > 0) return `closed ${formatAge(endedMs, now)}`;
    }
    return '';
}

function rowBadge(row: RecoverableAgentSession): {label: string; className: string} {
    if (row.attach) {
        const isThisProject: boolean = row.attach.session.classification === 'this-project';
        return {
            label: isThisProject ? 'This project' : 'Foreign project',
            className: isThisProject ? 'this-project' : 'foreign-project',
        };
    }
    if (row.status === 'exited') {
        return {label: 'Exited', className: 'closed exited'};
    }
    if (row.status === 'killed') {
        return {label: row.killReason ? `Killed (${row.killReason})` : 'Killed', className: 'closed killed'};
    }
    if (row.resume) {
        return {label: `Resumable (${row.resume.cliType})`, className: 'resumable'};
    }
    return {label: 'Surviving', className: 'this-project'};
}

function agentTypeLabel(row: RecoverableAgentSession): string | null {
    const raw: string | undefined = row.agentTypeName ?? row.terminalData.agentTypeName;
    if (!raw) return null;
    const trimmed: string = raw.trim();
    if (trimmed.length === 0) return null;
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

export function SurvivingAgentsSection({
    sessions,
    onRefresh,
    onAttach,
    onKill,
    onResume,
    renderRowActions,
}: SurvivingAgentsSectionProps): JSX.Element | null {
    const [busyKey, setBusyKey] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [resumeFailure, setResumeFailure] = useState<SurvivingAgentResumeFailure | null>(null);
    const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
    const [showingOlder, setShowingOlder] = useState<boolean>(false);
    const now: number = Date.now();

    const clearFailureState = useCallback((): void => {
        setError(null);
        setResumeFailure(null);
        setCopyState('idle');
    }, []);

    const handleRefresh: () => void = useCallback((): void => {
        clearFailureState();
        void Promise.resolve(onRefresh(showingOlder ? null : undefined)).catch((err: unknown): void => {
            setError(errorMessage(err));
        });
    }, [onRefresh, showingOlder, clearFailureState]);

    const handleToggleHorizon: () => void = useCallback((): void => {
        const nextShowingOlder: boolean = !showingOlder;
        setShowingOlder(nextShowingOlder);
        clearFailureState();
        void Promise.resolve(onRefresh(nextShowingOlder ? null : undefined)).catch((err: unknown): void => {
            setError(errorMessage(err));
        });
    }, [onRefresh, showingOlder, clearFailureState]);

    const runAction = useCallback((
        key: string,
        action: () => Promise<SurvivingAgentActionResult>,
    ): void => {
        setBusyKey(key);
        clearFailureState();
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
    }, [clearFailureState]);

    const runResume = useCallback((
        key: string,
        terminalId: string,
    ): void => {
        setBusyKey(key);
        clearFailureState();
        void onResume(terminalId)
            .then((result: SurvivingAgentResumeResult): void => {
                if (result.success) return;
                if (result.failure) {
                    setResumeFailure(result.failure);
                    return;
                }
                setError(result.error ?? 'Action failed');
            })
            .catch((err: unknown): void => {
                setError(errorMessage(err));
            })
            .finally((): void => {
                setBusyKey(null);
            });
    }, [onResume, clearFailureState]);

    const handleCopyManualCommand = useCallback((command: string): void => {
        const clipboard: Clipboard | undefined = navigator.clipboard;
        if (!clipboard) {
            setCopyState('error');
            return;
        }
        void clipboard.writeText(command)
            .then((): void => {
                setCopyState('copied');
            })
            .catch((): void => {
                setCopyState('error');
            });
    }, []);

    // Resumable Agents shows only unclaimed rows. Claimed rows (live tabs with
    // a resume handle) get a fork-on-hover button on the regular tab strip.
    const unclaimedSessions: readonly RecoverableAgentSession[] = sessions.filter((s) => !s.isClaimed);

    if (unclaimedSessions.length === 0 && !error && !resumeFailure && !showingOlder) return null;

    return (
        <section className="surviving-agents-section" aria-label="Resumable agents" data-testid="surviving-agents-section">
            <div className="terminal-tree-header surviving-agents-header">
                <span>Resumable agents ({unclaimedSessions.length})</span>
                <button
                    className="surviving-agents-refresh"
                    type="button"
                    onClick={handleRefresh}
                    title="Refresh resumable agents"
                    aria-label="Refresh resumable agents"
                >
                    <RefreshCw size={13} aria-hidden="true" />
                </button>
            </div>

            {resumeFailure && (
                <div
                    className="surviving-agents-error surviving-agents-resume-failure"
                    role="status"
                    data-testid="surviving-agents-resume-failure"
                    data-reason={resumeFailure.reason}
                    data-cli-type={resumeFailure.cliType}
                >
                    <div className="surviving-agents-resume-failure-message">
                        {RESUME_FAILURE_MESSAGES[resumeFailure.reason]}
                    </div>
                    {(() => {
                        const command: string | null = manualResumeCommand(resumeFailure);
                        if (!command) return null;
                        return (
                            <button
                                className="surviving-agents-copy-manual-command"
                                type="button"
                                onClick={() => handleCopyManualCommand(command)}
                                data-testid="surviving-agents-copy-manual-command"
                                title={command}
                                aria-label="Copy manual resume command"
                            >
                                <ClipboardCopy size={12} aria-hidden="true" />
                                <span>
                                    {copyState === 'copied'
                                        ? 'Copied'
                                        : copyState === 'error'
                                            ? 'Copy failed'
                                            : 'Copy manual resume command'}
                                </span>
                            </button>
                        );
                    })()}
                </div>
            )}

            {error && !resumeFailure && (
                <div className="surviving-agents-error" role="status">
                    {error}
                </div>
            )}

            <div className="surviving-agents-list">
                {unclaimedSessions.map((row: RecoverableAgentSession): JSX.Element => {
                    const key: string = recoverableAgentRowKey(row);
                    const isBusy: boolean = busyKey === key;
                    const badge: {label: string; className: string} = rowBadge(row);
                    const title: string = displayTitle(row);
                    const worktree: string | undefined = row.worktreeName ?? row.terminalData.worktreeName ?? undefined;
                    const agentType: string | null = agentTypeLabel(row);
                    return (
                        <div
                            key={key}
                            className="surviving-agent-row"
                            data-terminal-id={row.terminalId}
                            data-status={row.status}
                            data-has-attach={row.attach ? 'true' : 'false'}
                            data-has-resume={row.resume ? 'true' : 'false'}
                            data-session-name={row.attach?.session.sessionName}
                            title={rowTooltip(row)}
                        >
                            <div className="surviving-agent-main">
                                <div className="surviving-agent-title-row">
                                    <span
                                        className="surviving-agent-title surviving-agent-title-mono"
                                        title={title}
                                    >
                                        {title}
                                    </span>
                                    {agentType && (
                                        <span
                                            className="surviving-agent-badge surviving-agent-type-badge"
                                            data-agent-type={agentType.toLowerCase()}
                                        >
                                            {agentType}
                                        </span>
                                    )}
                                    <span className={`surviving-agent-badge ${badge.className}`}>
                                        {badge.label}
                                    </span>
                                </div>
                                <div className="surviving-agent-meta">
                                    {worktree && (
                                        <span className="surviving-agent-worktree-chip" title={`worktree: ${worktree}`}>
                                            <GitBranch size={11} aria-hidden="true" />
                                            <span>{worktree}</span>
                                        </span>
                                    )}
                                    <span className="surviving-agent-meta-text">{rowMeta(row, now)}</span>
                                </div>
                            </div>
                            <div className="surviving-agent-actions" data-testid={`surviving-agent-actions-${row.terminalId}`}>
                                {row.attach && row.attach.session.attachable && (
                                    <button
                                        className="surviving-agent-action attach"
                                        type="button"
                                        onClick={() => runAction(key, () => onAttach(row.attach!.session.sessionName))}
                                        title="Attach live tmux pane"
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
                                        onClick={() => runResume(key, row.terminalId)}
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
                                        title="Kill live tmux session"
                                        aria-label={`Kill ${row.agentName || row.terminalId}`}
                                        disabled={isBusy}
                                    >
                                        <X size={13} aria-hidden="true" />
                                    </button>
                                )}
                                {renderRowActions?.(row)}
                            </div>
                        </div>
                    );
                })}
            </div>

            <button
                className="surviving-agents-show-older"
                type="button"
                onClick={handleToggleHorizon}
                aria-pressed={showingOlder}
                data-testid="surviving-agents-show-older"
            >
                {showingOlder ? 'Hide older agents' : 'Show older agents'}
            </button>
        </section>
    );
}
