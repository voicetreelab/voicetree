const RULE_ID = 'subgraph_size_limit' as const

const GARDENING_INSTRUCTION =
    'Please garden the nearby nodes so that each cluster is in a suitable folder, with an accurate folder name (longer is better), and a child folder note `<name>.md` containing a max 15-line summary of the contents of the folder.'

const NO_ROUTINE_OVERRIDE_INSTRUCTION =
    'Do not override this for routine progress nodes; the size gate exists to force continuous graph gardening.'

function formatViolationMessage(
    folderName: string,
    size: number,
    errorThreshold: number,
): string {
    return `Folder "${folderName}" would reach ${size} nodes, at or above the block threshold of ${errorThreshold}. ${GARDENING_INSTRUCTION} ${NO_ROUTINE_OVERRIDE_INSTRUCTION}`
}

function formatGuidance(): string {
    return `For [${RULE_ID}], ${GARDENING_INSTRUCTION} ${NO_ROUTINE_OVERRIDE_INSTRUCTION}`
}

function formatManualGuidance(): string {
    return `If \`${RULE_ID}\` blocks creation, do not override it for routine progress. Garden the nearby nodes so each cluster lives in a suitable folder with an accurate, descriptive folder name (longer is better), plus a child folder note \`<name>.md\` containing a max 15-line summary of the folder contents.`
}

function formatOverrideDescription(): string {
    return `Do not use this for \`${RULE_ID}\` unless a human explicitly asks to keep the folder flat; garden nearby nodes into named cluster folders with max 15-line folder-note summaries instead.`
}

export const SUBGRAPH_SIZE_LIMIT_GUIDANCE = {
    ruleId: RULE_ID,
    gardeningInstruction: GARDENING_INSTRUCTION,
    noRoutineOverrideInstruction: NO_ROUTINE_OVERRIDE_INSTRUCTION,
    formatViolationMessage,
    formatGuidance,
    formatManualGuidance,
    formatOverrideDescription,
} as const
