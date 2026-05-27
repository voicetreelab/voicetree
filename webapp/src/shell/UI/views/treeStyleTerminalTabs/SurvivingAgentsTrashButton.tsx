import {useCallback, useState} from 'react';
import type {JSX} from 'react';
import {Trash2} from 'lucide-react';

type DeleteResult = {readonly success: boolean; readonly error?: string};

type SurvivingAgentsTrashButtonProps = {
    readonly terminalId: string;
    readonly onDelete: (terminalId: string) => Promise<DeleteResult>;
    readonly confirmDelete?: (terminalId: string) => boolean;
};

function defaultConfirm(terminalId: string): boolean {
    return window.confirm(`Permanently delete ${terminalId} history and logs?`);
}

/**
 * Per-row trash button rendered into the SurvivingAgentsSection via the
 * `renderRowActions` slot. Confirm-then-delete keeps users from nuking
 * unrecoverable history with a stray click. Errors surface inline via title
 * tooltip rather than throwing, so a refused-or-failed delete leaves the row
 * untouched and the user can retry.
 *
 * The component owns its own busy + error state to keep the
 * `renderRowActions` contract narrow (just `row → ReactNode`); the parent
 * section is unaware of which custom actions exist.
 */
export function SurvivingAgentsTrashButton({
    terminalId,
    onDelete,
    confirmDelete = defaultConfirm,
}: SurvivingAgentsTrashButtonProps): JSX.Element {
    const [isBusy, setBusy] = useState<boolean>(false);
    const [errorText, setErrorText] = useState<string | null>(null);

    const handleClick: (e: React.MouseEvent) => void = useCallback((e: React.MouseEvent): void => {
        e.stopPropagation();
        if (!confirmDelete(terminalId)) return;
        setBusy(true);
        setErrorText(null);
        void onDelete(terminalId)
            .then((result: DeleteResult): void => {
                if (!result.success) setErrorText(result.error ?? 'Delete failed');
            })
            .catch((err: unknown): void => {
                setErrorText(err instanceof Error ? err.message : String(err));
            })
            .finally((): void => {
                setBusy(false);
            });
    }, [confirmDelete, terminalId, onDelete]);

    const tooltip: string = errorText
        ? `Delete failed: ${errorText}`
        : `Permanently delete ${terminalId}`;

    return (
        <button
            className="surviving-agent-action surviving-agent-action-delete"
            data-testid={`surviving-agent-trash-${terminalId}`}
            type="button"
            onClick={handleClick}
            disabled={isBusy}
            title={tooltip}
            aria-label={`Delete ${terminalId} history and logs`}
        >
            <Trash2 size={12} aria-hidden="true" />
        </button>
    );
}
