/**
 * Pure parsing layer for `vt view ...`: the parsed-command ADT, the usage
 * string, the `validationError` sink, and `parseViewCommand` with its pure
 * argument helpers.
 *
 * This is the pure half of the `vt view` command. It performs no I/O and has
 * no daemon dependency — given an argv array it returns a `ParsedViewCommand`
 * or throws `ArgValidationError`. The impure runner shell lives in `view.ts`
 * and consumes this module's `parseViewCommand` / ADT / `validationError`.
 *
 * Split out of `view.ts` only because the combined file exceeded the
 * 500-line hard limit; the pure/impure seam is the natural cut.
 */

import {resolve as resolvePath} from 'node:path'
import {type FolderState, type SelectionMode} from '@vt/graph-db-client'
import {ArgValidationError} from '../util/exitCodes'
import {parseSessionFlag} from '../util/sessionFlag'

export const VIEW_USAGE: string = `Usage:
  vt view list [--project <path>] [--json]
  vt view switch <id-or-name> [--project <path>] [--json]
  vt view clone <src-id-or-name> <dst-name> [--project <path>] [--json]
  vt view delete <id-or-name> [--project <path>] [--json]
  vt view set-folder <path> <expanded|collapsed|hidden> [--project <path>] [--session <id>] [--json]
  vt view selection set <nodeIds...> [--project <path>] [--session <id>] [--json]
  vt view selection add <nodeIds...> [--project <path>] [--session <id>] [--json]
  vt view selection remove <nodeIds...> [--project <path>] [--session <id>] [--json]
  vt view show [--project <path>] [--session <id>] [--json]
  vt view layout set-pan <x> <y> [--project <path>] [--session <id>] [--json]
  vt view layout set-zoom <zoom> [--project <path>] [--session <id>] [--json]
  vt view layout set-positions <positions-json-file> [--project <path>] [--session <id>] [--json]`

export function validationError(message?: string): never {
    throw new ArgValidationError(message === undefined ? VIEW_USAGE : `${message}\n\n${VIEW_USAGE}`)
}

// ────────────────────────────────────────────────────────────────────────
// Parsed command ADT.
// ────────────────────────────────────────────────────────────────────────

type ParsedViewBase = {
    forceJson: boolean
    sessionFlag?: string
    projectFlag?: string
}

export type ParsedSetPanCommand = ParsedViewBase & {
    branch: 'layout'
    subcommand: 'set-pan'
    x: number
    y: number
}

export type ParsedSetPositionsCommand = ParsedViewBase & {
    branch: 'layout'
    positionsFile: string
    subcommand: 'set-positions'
}

export type ParsedSetZoomCommand = ParsedViewBase & {
    branch: 'layout'
    subcommand: 'set-zoom'
    zoom: number
}

export type ParsedLayoutCommand =
    | ParsedSetPanCommand
    | ParsedSetPositionsCommand
    | ParsedSetZoomCommand

export type ParsedListCommand = ParsedViewBase & {
    branch: 'list'
}

export type ParsedSwitchCommand = ParsedViewBase & {
    branch: 'switch'
    target: string
}

export type ParsedCloneCommand = ParsedViewBase & {
    branch: 'clone'
    source: string
    name: string
}

export type ParsedDeleteCommand = ParsedViewBase & {
    branch: 'delete'
    target: string
}

export type ParsedSetFolderCommand = ParsedViewBase & {
    branch: 'set-folder'
    folderPath: string
    state: FolderState
}

export type ParsedSelectionCommand = ParsedViewBase & {
    branch: 'selection'
    mode: SelectionMode
    nodeIds: string[]
}

export type ParsedShowCommand = ParsedViewBase & {
    branch: 'show'
}

export type ParsedViewCommand =
    | ParsedLayoutCommand
    | ParsedListCommand
    | ParsedSwitchCommand
    | ParsedCloneCommand
    | ParsedDeleteCommand
    | ParsedSetFolderCommand
    | ParsedSelectionCommand
    | ParsedShowCommand

function readRequiredFlagValue(argv: string[], index: number, flag: string): string {
    const value: string | undefined = argv[index + 1]
    if (!value || value.startsWith('--')) {
        validationError(`${flag} requires a value`)
    }
    return value
}

function parseOptionalFlagAssignment(flag: string, arg: string): string {
    const value: string = arg.slice(`${flag}=`.length)
    if (!value) {
        validationError(`${flag} requires a value`)
    }
    return value
}

function parseNumberArg(value: string, label: 'x' | 'y' | 'zoom'): number {
    const parsed: number = Number(value)
    if (!Number.isFinite(parsed)) {
        validationError(`${label} must be a finite number.`)
    }
    return parsed
}

// Zoom is a multiplicative viewport scale factor: it must be strictly
// positive (0 collapses the viewport; negatives are meaningless) and within
// the renderer's own clamp range. Cytoscape's defaults are
// minZoom = 1e-50 / maxZoom = 1e50, so we reject anything the renderer would
// itself refuse rather than inventing an arbitrary magic bound.
const MIN_ZOOM: number = 1e-50
const MAX_ZOOM: number = 1e50

function parseZoomArg(value: string): number {
    const zoom: number = parseNumberArg(value, 'zoom')
    if (zoom < MIN_ZOOM || zoom > MAX_ZOOM) {
        validationError(
            `zoom must be a positive number between ${MIN_ZOOM} and ${MAX_ZOOM}.`,
        )
    }
    return zoom
}

function requireSingleValue(args: string[], label: string, commandLabel: string): string {
    if (args.length === 0) {
        validationError(`Missing required ${label} for \`${commandLabel}\`.`)
    }
    if (args.length > 1) {
        validationError(`Too many positional arguments for \`${commandLabel}\`.`)
    }
    return args[0]
}

function parseSelectionMode(value: string | undefined): SelectionMode {
    switch (value) {
        case 'set':
            return 'replace'
        case 'add':
            return 'add'
        case 'remove':
            return 'remove'
        case undefined:
            return validationError('Missing required selection subcommand.')
        default:
            return validationError(`Unknown selection subcommand: ${value}`)
    }
}

function parseFolderState(value: string | undefined): FolderState {
    switch (value) {
        case 'expanded':
        case 'collapsed':
        case 'hidden':
            return value
        case undefined:
            return validationError('Missing required <expanded|collapsed|hidden> for `set-folder`.')
        default:
            return validationError(`Unknown folder state: ${value}`)
    }
}

export function parseViewCommand(argv: string[]): ParsedViewCommand {
    const {remaining, session} = parseSessionFlag(argv)
    const positionalArgs: string[] = []
    let forceJson: boolean = false
    let projectFlag: string | undefined

    for (let index: number = 0; index < remaining.length; index += 1) {
        const arg: string = remaining[index]
        if (arg === '--json') {
            forceJson = true
            continue
        }
        if (arg === '--project') {
            projectFlag = readRequiredFlagValue(remaining, index, '--project')
            index += 1
            continue
        }
        if (arg.startsWith('--project=')) {
            projectFlag = parseOptionalFlagAssignment('--project', arg)
            continue
        }
        if (arg === '--help' || arg === '-h') {
            validationError()
        }
        if (arg.startsWith('--')) {
            validationError(`Unknown argument: ${arg}`)
        }
        positionalArgs.push(arg)
    }

    const [rawBranch, ...rest] = positionalArgs
    if (!rawBranch) {
        validationError()
    }

    if (rawBranch === 'list') {
        if (rest.length > 0) {
            validationError('`list` does not accept positional arguments.')
        }
        return {branch: 'list', projectFlag, sessionFlag: session, forceJson}
    }

    if (rawBranch === 'switch') {
        return {
            branch: 'switch',
            target: requireSingleValue(rest, '<id-or-name>', 'switch'),
            projectFlag,
            sessionFlag: session,
            forceJson,
        }
    }

    if (rawBranch === 'clone') {
        if (rest.length < 2) {
            validationError('Missing required <src-id-or-name> <dst-name> for `clone`.')
        }
        if (rest.length > 2) {
            validationError('Too many positional arguments for `clone`.')
        }
        return {
            branch: 'clone',
            source: rest[0],
            name: rest[1],
            projectFlag,
            sessionFlag: session,
            forceJson,
        }
    }

    if (rawBranch === 'delete') {
        return {
            branch: 'delete',
            target: requireSingleValue(rest, '<id-or-name>', 'delete'),
            projectFlag,
            sessionFlag: session,
            forceJson,
        }
    }

    if (rawBranch === 'set-folder') {
        if (rest.length < 2) {
            validationError('Missing required <path> <expanded|collapsed|hidden> for `set-folder`.')
        }
        if (rest.length > 2) {
            validationError('Too many positional arguments for `set-folder`.')
        }
        return {
            branch: 'set-folder',
            folderPath: resolvePath(rest[0]),
            state: parseFolderState(rest[1]),
            projectFlag,
            sessionFlag: session,
            forceJson,
        }
    }

    if (rawBranch === 'selection') {
        const [rawMode, ...nodeIds] = rest
        const mode: SelectionMode = parseSelectionMode(rawMode)
        if (nodeIds.length === 0) {
            validationError(`Missing required <nodeIds...> for \`selection ${rawMode}\`.`)
        }
        return {branch: 'selection', mode, nodeIds, projectFlag, sessionFlag: session, forceJson}
    }

    if (rawBranch === 'show') {
        if (rest.length > 0) {
            validationError('`show` does not accept positional arguments.')
        }
        return {branch: 'show', projectFlag, sessionFlag: session, forceJson}
    }

    if (rawBranch !== 'layout') {
        validationError(`Unknown view subcommand: ${rawBranch}`)
    }

    const [rawSubcommand, ...layoutArgs] = rest

    switch (rawSubcommand) {
        case 'set-pan':
            if (layoutArgs.length < 2) {
                validationError('Missing required <x> <y> for `layout set-pan`.')
            }
            if (layoutArgs.length > 2) {
                validationError('Too many positional arguments for `layout set-pan`.')
            }
            return {
                branch: 'layout',
                subcommand: 'set-pan',
                x: parseNumberArg(layoutArgs[0], 'x'),
                y: parseNumberArg(layoutArgs[1], 'y'),
                projectFlag,
                sessionFlag: session,
                forceJson,
            }
        case 'set-zoom':
            if (layoutArgs.length === 0) {
                validationError('Missing required <zoom> for `layout set-zoom`.')
            }
            if (layoutArgs.length > 1) {
                validationError('Too many positional arguments for `layout set-zoom`.')
            }
            return {
                branch: 'layout',
                subcommand: 'set-zoom',
                zoom: parseZoomArg(layoutArgs[0]),
                projectFlag,
                sessionFlag: session,
                forceJson,
            }
        case 'set-positions':
            if (layoutArgs.length === 0) {
                validationError('Missing required <positions-json-file> for `layout set-positions`.')
            }
            if (layoutArgs.length > 1) {
                validationError('Too many positional arguments for `layout set-positions`.')
            }
            return {
                branch: 'layout',
                subcommand: 'set-positions',
                positionsFile: resolvePath(layoutArgs[0]),
                projectFlag,
                sessionFlag: session,
                forceJson,
            }
        case undefined:
            return validationError('Missing required layout subcommand.')
        default:
            return validationError(`Unknown layout subcommand: ${rawSubcommand}`)
    }
}
