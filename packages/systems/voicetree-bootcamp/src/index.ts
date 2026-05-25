export type {
    CellResult,
    CommandAttempt,
    CommandPattern,
    Coverage,
    Effort,
    FitnessBreakdown,
    HarnessDriver,
    RunTelemetry,
    ScenarioSpec,
    ScoreOutcome,
    ShimLogEntry,
    SuccessResult,
} from './types.ts'
export {OUTCOME_SCORES} from './types.ts'
export {aggregateScore, scoreCommand, scoreFor, scoreScenario} from './scoring.ts'
export {matchesVerb, parseShimLog} from './shim-log.ts'
