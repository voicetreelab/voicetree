export const TASK_FOLDER_NODES_FLAG: 'VT_ENABLE_TASK_FOLDER_NODES' = 'VT_ENABLE_TASK_FOLDER_NODES'

export function taskFolderNodesEnabledFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
    const raw: string | undefined = env[TASK_FOLDER_NODES_FLAG]
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}
