// IR types for the workflow generator. Shared between the pure transform
// (`tierSpecsToWorkflow`) and the pure formatter (`workflowYamlToText`).

export type Step =
    | {kind: 'checkout'}
    | {kind: 'setup-node'; node: string}
    | {kind: 'npm-ci'}
    | {kind: 'playwright-install'}
    | {kind: 'run'; name: string; run: string; id?: string; env?: Record<string, string>}
    | {kind: 'upload-artifact'; name: string; path: string}
    | {kind: 'download-artifact'; pattern: string; path: string}

export type Job = {
    readonly id: string
    readonly name: string
    readonly runsOn: string
    readonly needs: readonly string[]
    readonly ifExpr: string | null
    readonly strategy: {readonly matrix: {readonly check_id: readonly string[]}} | null
    readonly outputs: Record<string, string> | null
    readonly steps: readonly Step[]
}

export type WorkflowYaml = {
    readonly name: string
    readonly jobs: readonly Job[]
}
