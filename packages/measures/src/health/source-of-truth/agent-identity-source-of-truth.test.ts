import {readFile} from 'node:fs/promises'
import {describe, expect, it} from 'vitest'
import {
    findIdentitySourceOfTruthViolations,
    type SourceFile,
} from './agent-identity-source-of-truth'
import {discoverPackages} from '../../_shared/discovery/discover-packages'
import {discoverSourceFiles} from '../../_shared/discovery/function-discovery'

describe('findIdentitySourceOfTruthViolations (pure policy)', () => {
    it('flags an object type that stores both terminalId and agentName', () => {
        const files: readonly SourceFile[] = [{
            filePath: 'x.ts',
            content: `export type TerminalData = {
                readonly terminalId: TerminalId
                readonly title: string
                readonly agentName: string
            }`,
        }]
        expect(findIdentitySourceOfTruthViolations(files)).toEqual([
            {filePath: 'x.ts', typeName: 'TerminalData'},
        ])
    })

    it('does NOT flag a type that stores agentName WITHOUT a terminalId (a different concept)', () => {
        const files: readonly SourceFile[] = [{
            filePath: 'metrics.ts',
            content: `export type AgentMetrics = {
                readonly agentName: string
                readonly tokens: number
            }`,
        }]
        expect(findIdentitySourceOfTruthViolations(files)).toEqual([])
    })

    it('does NOT flag a type that stores only the id (the single source of truth)', () => {
        const files: readonly SourceFile[] = [{
            filePath: 'ok.ts',
            content: `export interface TerminalRecord {
                readonly terminalId: string
                readonly status: string
            }`,
        }]
        expect(findIdentitySourceOfTruthViolations(files)).toEqual([])
    })

    it('handles nested braces and interfaces', () => {
        const files: readonly SourceFile[] = [{
            filePath: 'nested.ts',
            content: `export interface S {
                readonly terminalId: string
                readonly dims: { readonly w: number }
                readonly agentName: string
            }`,
        }]
        expect(findIdentitySourceOfTruthViolations(files)).toEqual([
            {filePath: 'nested.ts', typeName: 'S'},
        ])
    })
})

describe('agent identity has a single source of truth across the repo', () => {
    it('stores no agentName alongside a terminalId — the name is a pure function of the id', async () => {
        const packages = await discoverPackages()
        const fileInfos = await discoverSourceFiles(packages)
        const files: readonly SourceFile[] = await Promise.all(
            fileInfos.map(async info => ({
                filePath: info.relativePath,
                content: await readFile(info.absolutePath, 'utf8'),
            })),
        )

        const violations = findIdentitySourceOfTruthViolations(files)
        const report: string = violations
            .map(v => `  - ${v.typeName}  (${v.filePath})`)
            .join('\n')

        expect(
            violations,
            `Agent identity must have ONE source of truth (terminalId). These types store a\n`
            + `redundant agentName that can drift from the id — derive it via agentBaseName instead:\n${report}`,
        ).toEqual([])
    })
})
