import {describe, expect, it} from 'vitest'
import {extractVitestFailureDetails, vitestOutputFileFromArgs} from '../../_shared/writers/vitest-failure-details'

describe('Vitest failure details extraction', () => {
    it('finds the output file argument in Vitest argv forms', () => {
        expect(vitestOutputFileFromArgs(['vitest', 'run', '--outputFile=/tmp/vitest.json'])).toBe('/tmp/vitest.json')
        expect(vitestOutputFileFromArgs(['vitest', 'run', '--outputFile', '/tmp/space.json'])).toBe('/tmp/space.json')
        expect(vitestOutputFileFromArgs(['vitest', 'run'])).toBeNull()
    })

    it('summarizes failing assertion results from a Vitest JSON report', () => {
        const report = {
            testResults: [
                {
                    name: '/repo/packages/measures/src/health/example.test.ts',
                    assertionResults: [
                        {
                            fullName: 'example suite passes',
                            status: 'passed',
                            failureMessages: [],
                        },
                        {
                            fullName: 'example suite fails usefully',
                            status: 'failed',
                            failureMessages: [
                                'AssertionError: expected 1 to be 2\n    at example.test.ts:10:5\n',
                            ],
                        },
                    ],
                },
                {
                    name: '/repo/packages/measures/src/health/other.test.ts',
                    assertionResults: [
                        {
                            ancestorTitles: ['other suite'],
                            title: 'fails without fullName',
                            status: 'failed',
                            failureMessages: ['second failure line'],
                        },
                    ],
                },
            ],
        }

        expect(extractVitestFailureDetails(report)).toEqual({
            failedTests: [
                {
                    fileName: '/repo/packages/measures/src/health/example.test.ts',
                    fullName: 'example suite fails usefully',
                    message: 'AssertionError: expected 1 to be 2\n    at example.test.ts:10:5',
                },
                {
                    fileName: '/repo/packages/measures/src/health/other.test.ts',
                    fullName: 'other suite fails without fullName',
                    message: 'second failure line',
                },
            ],
            failedTestsTruncated: false,
        })
    })

    it('bounds embedded failure details', () => {
        const report = {
            testResults: [
                {
                    name: 'many.test.ts',
                    assertionResults: [
                        {fullName: 'first fails', status: 'failed', failureMessages: ['x'.repeat(40)]},
                        {fullName: 'second fails', status: 'failed', failureMessages: ['second']},
                    ],
                },
            ],
        }

        expect(extractVitestFailureDetails(report, {maxFailures: 1, maxMessageChars: 10, maxTotalMessageChars: 10})).toEqual({
            failedTests: [
                {
                    fileName: 'many.test.ts',
                    fullName: 'first fails',
                    message: 'xxxxxxx...',
                },
            ],
            failedTestsTruncated: true,
        })
    })
})
