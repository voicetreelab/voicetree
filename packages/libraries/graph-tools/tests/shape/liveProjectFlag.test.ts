/**
 * `--project` parsing for `vt-graph live` verbs.
 *
 * Resolves the doc-vs-impl drift where the manual documented a `--project`
 * flag on the live verbs but the bin parser rejected it. The underlying
 * `live*` functions already accept `options.projectPath` and pass it to
 * `createLiveTransport(projectPath)`, so the only gap was the parsers.
 *
 * Black-box: feed each parser a real argv slice and assert on the returned
 * `projectPath` (the observable parse result), plus that the flag coexists
 * with the verb's own flags/positionals and that a missing value fails. No
 * internal mocking — these are pure functions over argv.
 */
import {describe, expect, it} from 'vitest'

import {
  parseLiveApplyArgs,
  parseLiveNeighborhoodArgs,
  parseLivePathArgs,
  parseLiveStateDumpArgs,
  parseLiveViewArgs,
} from '../../bin/vt-graph/commands/live'

const PROJECT = '/tmp/vt-some-project'

describe('vt-graph live --project parsing', () => {
  describe('view', () => {
    it('parses --project <path> (space form) without disturbing other flags', () => {
      const parsed = parseLiveViewArgs(['--mermaid', '--project', PROJECT, '--collapse', 'sub'])
      expect(parsed.projectPath).toBe(PROJECT)
      expect(parsed.format).toBe('mermaid')
      expect(parsed.collapsedFolders).toEqual(['sub'])
    })

    it('parses --project=<path> (equals form)', () => {
      const parsed = parseLiveViewArgs([`--project=${PROJECT}`])
      expect(parsed.projectPath).toBe(PROJECT)
    })

    it('leaves projectPath undefined when --project is absent', () => {
      const parsed = parseLiveViewArgs(['--ascii'])
      expect(parsed.projectPath).toBeUndefined()
    })

    it('fails when --project has no value', () => {
      expect(() => parseLiveViewArgs(['--project'])).toThrow('--project requires a value')
    })
  })

  describe('state dump', () => {
    it('parses --project alongside --no-pretty', () => {
      const parsed = parseLiveStateDumpArgs(['--no-pretty', '--project', PROJECT])
      expect(parsed.projectPath).toBe(PROJECT)
      expect(parsed.pretty).toBe(false)
    })

    it('parses --project=<path>', () => {
      const parsed = parseLiveStateDumpArgs([`--project=${PROJECT}`])
      expect(parsed.projectPath).toBe(PROJECT)
      expect(parsed.pretty).toBe(true)
    })
  })

  describe('apply', () => {
    it('parses --project without consuming the positional JSON command', () => {
      const parsed = parseLiveApplyArgs(['--project', PROJECT, '{"type":"Select","ids":[]}'])
      expect(parsed.projectPath).toBe(PROJECT)
      expect(parsed.cmdJson).toBe('{"type":"Select","ids":[]}')
    })

    it('parses --project=<path> after the positional JSON command', () => {
      const parsed = parseLiveApplyArgs(['{"type":"Select","ids":[]}', `--project=${PROJECT}`])
      expect(parsed.projectPath).toBe(PROJECT)
      expect(parsed.cmdJson).toBe('{"type":"Select","ids":[]}')
    })
  })

  describe('focus / neighbors (neighborhood args)', () => {
    it('parses --project alongside the node positional and --hops', () => {
      const parsed = parseLiveNeighborhoodArgs(
        ['node.md', '--hops', '2', '--project', PROJECT],
        'usage',
      )
      expect(parsed.projectPath).toBe(PROJECT)
      expect(parsed.nodeId).toBe('node.md')
      expect(parsed.hops).toBe(2)
    })

    it('parses --project=<path>', () => {
      const parsed = parseLiveNeighborhoodArgs(['node.md', `--project=${PROJECT}`], 'usage')
      expect(parsed.projectPath).toBe(PROJECT)
    })
  })

  describe('path', () => {
    it('parses --project alongside the two node positionals', () => {
      const parsed = parseLivePathArgs(['a.md', 'b.md', '--project', PROJECT])
      expect(parsed.projectPath).toBe(PROJECT)
      expect(parsed.nodeA).toBe('a.md')
      expect(parsed.nodeB).toBe('b.md')
    })

    it('parses --project=<path>', () => {
      const parsed = parseLivePathArgs(['a.md', 'b.md', `--project=${PROJECT}`])
      expect(parsed.projectPath).toBe(PROJECT)
    })
  })
})
