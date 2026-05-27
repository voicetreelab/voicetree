import {useEffect, useState} from 'react';
import type {RecoverableAgentSession, UnclaimedTmuxSession} from '@vt/vt-daemon-client';
import {
    getUnclaimedTmuxSessions,
    subscribeToUnclaimedTmuxChanges,
} from '@/shell/edge/UI-edge/state/stores/recovery/UnclaimedTmuxStore';
import {
    getRecoverySessions,
    subscribeToRecoverySessions,
} from '@/shell/edge/UI-edge/state/stores/recovery/RecoverySessionsStore';

export function useUnclaimedTmuxSessions(): readonly UnclaimedTmuxSession[] {
    const [unclaimed, setUnclaimed] = useState<readonly UnclaimedTmuxSession[]>(
        () => getUnclaimedTmuxSessions(),
    );

    useEffect((): (() => void) => {
        return subscribeToUnclaimedTmuxChanges(setUnclaimed);
    }, []);

    return unclaimed;
}

export function useRecoverySessions(): readonly RecoverableAgentSession[] {
    const [recovery, setRecovery] = useState<readonly RecoverableAgentSession[]>(
        () => getRecoverySessions(),
    );

    useEffect((): (() => void) => {
        return subscribeToRecoverySessions(setRecovery);
    }, []);

    return recovery;
}
