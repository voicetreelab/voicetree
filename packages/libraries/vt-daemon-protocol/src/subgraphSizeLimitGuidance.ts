const RULE_ID = 'subgraph_size_limit' as const

const GARDENING_INSTRUCTION =
    'Please garden the nearby nodes so that each cluster is in a suitable folder, with an accurate folder name (longer is better), and a child folder note `<name>.md` containing a max 15-line summary of the contents of the folder.'

const NO_ROUTINE_OVERRIDE_INSTRUCTION =
    'Do not override this for routine progress nodes; the size gate exists to force continuous graph gardening.'

/**
 * The block presents a 3-way choice (mirrors `vt graph garden`): accept the
 * auto-suggested grouping, reject it and choose nodes manually, or bypass with a
 * rationale. `proposalPreview` is the (optional) pre-rendered suggestion computed
 * from the graph by the caller; `folderPath` is the garden target.
 */
function formatViolationMessage(
    folderName: string,
    folderPath: string,
    size: number,
    errorThreshold: number,
    proposalPreview: string,
): string {
    const garden = `vt graph garden "${folderPath}"`
    const acceptOption: string = proposalPreview === ''
        ? `[1] ACCEPT auto-grouping — run \`${garden}\` to see the proposal, then \`${garden} --apply\`, then retry this create.`
        : [
            '[1] ACCEPT the suggested grouping — auto-file these into sub-folders:',
            proposalPreview,
            `    Run:  ${garden} --apply   (then retry this create).`,
        ].join('\n')

    return [
        `Folder "${folderName}" would reach ${size} nodes, at or above the block threshold of ${errorThreshold}. ${GARDENING_INSTRUCTION} Choose one:`,
        '',
        acceptOption,
        '',
        `[2] REJECT the proposal and CHOOSE MANUALLY which nodes go where — run \`${garden}\` for an editable plan, edit it, then \`${garden} --apply --plan <file>\`, then retry this create.`,
        '',
        `[3] BYPASS, only if absolutely necessary — ${NO_ROUTINE_OVERRIDE_INSTRUCTION} Retry this create with override_with_rationale: [{"ruleId":"${RULE_ID}","rationale":"<why this folder should stay flat>"}].`,
    ].join('\n')
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
