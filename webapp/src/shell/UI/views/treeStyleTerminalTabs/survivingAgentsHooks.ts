import {useEffect, useState} from 'react';
import type {RecoverableAgentSession} from '@vt/vt-daemon-client';
import {
    getRecoverySessions,
    subscribeToRecoverySessions,
} from '@/shell/edge/UI-edge/state/stores/recovery/RecoverySessionsStore';

export function useRecoverySessions(): readonly RecoverableAgentSession[] {
    const [recovery, setRecovery] = useState<readonly RecoverableAgentSession[]>(
        () => getRecoverySessions(),
    );

    useEffect((): (() => void) => {
        return subscribeToRecoverySessions(setRecovery);
    }, []);

    return recovery;
}
