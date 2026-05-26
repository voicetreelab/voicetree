import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildPyroscopeRenderUrl,
  countTimelineSamples,
  deriveProfileQuery,
  flattenTrace,
  labelSelectorForSpan,
  parseArgs,
  profileWindowForSpan,
  selectSpan,
} from './profile-for-trace.mjs'

const b64 = (hex) => Buffer.from(hex, 'hex').toString('base64')

const tracePayload = {
  trace: {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'vt-graphd' } },
            { key: 'service.instance.id', value: { stringValue: 'run-123' } },
          ],
        },
        scopeSpans: [
          {
            spans: [
              {
                traceId: b64('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
                spanId: b64('1111111111111111'),
                name: 'short',
                startTimeUnixNano: '1000000000000',
                endTimeUnixNano: '1005000000000',
                attributes: [],
              },
              {
                traceId: b64('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
                spanId: b64('2222222222222222'),
                name: 'slow-work',
                startTimeUnixNano: '1010000000000',
                endTimeUnixNano: '1045000000000',
                attributes: [{ key: 'custom', value: { stringValue: 'value' } }],
              },
            ],
          },
        ],
      },
    ],
  },
}

test('flattenTrace reads Tempo v2 OTLP JSON into simple spans', () => {
  assert.deepEqual(flattenTrace(tracePayload), [
    {
      traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      spanId: '1111111111111111',
      parentSpanId: '',
      name: 'short',
      startMs: 1_000_000,
      endMs: 1_005_000,
      durationMs: 5_000,
      serviceName: 'vt-graphd',
      serviceInstanceId: 'run-123',
      resourceAttrs: {
        'service.name': 'vt-graphd',
        'service.instance.id': 'run-123',
      },
      spanAttrs: {},
    },
    {
      traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      spanId: '2222222222222222',
      parentSpanId: '',
      name: 'slow-work',
      startMs: 1_010_000,
      endMs: 1_045_000,
      durationMs: 35_000,
      serviceName: 'vt-graphd',
      serviceInstanceId: 'run-123',
      resourceAttrs: {
        'service.name': 'vt-graphd',
        'service.instance.id': 'run-123',
      },
      spanAttrs: { custom: 'value' },
    },
  ])
})

test('selectSpan defaults to the longest span and supports explicit selectors', () => {
  const spans = flattenTrace(tracePayload)
  assert.equal(selectSpan(spans).spanId, '2222222222222222')
  assert.equal(selectSpan(spans, { spanId: '1111111111111111' }).name, 'short')
  assert.equal(selectSpan(spans, { spanName: 'slow-work' }).spanId, '2222222222222222')
})

test('profile query derivation remaps OTel resource attributes to Pyroscope labels', () => {
  const result = deriveProfileQuery(tracePayload, {
    traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    pyroscopeUrl: 'http://localhost:4040',
    profileType: 'wall:cpu:nanoseconds:wall:nanoseconds',
    paddingMs: 60_000,
  })

  assert.equal(result.selected_span.name, 'slow-work')
  assert.equal(
    result.profile_query,
    'wall:cpu:nanoseconds:wall:nanoseconds{service_name="vt-graphd",service_instance_id="run-123"}',
  )
  assert.equal(result.profile_window.from_ms, 950_000)
  assert.equal(result.profile_window.until_ms, 1_105_000)
  assert.match(result.pyroscope_render_url, /query=wall%3Acpu%3Ananoseconds/)
})

test('labelSelectorForSpan escapes Pyroscope label values', () => {
  assert.equal(
    labelSelectorForSpan({
      serviceName: 'service"quoted',
      serviceInstanceId: 'run\\slash',
    }),
    '{service_name="service\\"quoted",service_instance_id="run\\\\slash"}',
  )
})

test('profileWindowForSpan applies non-negative padding window', () => {
  assert.deepEqual(profileWindowForSpan({ startMs: 10_000, endMs: 12_000 }, 20_000), {
    fromMs: 0,
    untilMs: 32_000,
  })
})

test('buildPyroscopeRenderUrl creates render API URL', () => {
  assert.equal(
    buildPyroscopeRenderUrl({
      pyroscopeUrl: 'http://localhost:4040',
      profileType: 'wall:cpu:nanoseconds:wall:nanoseconds',
      labelSelector: '{service_name="vt-graphd"}',
      fromMs: 1_000,
      untilMs: 2_001,
    }).toString(),
    'http://localhost:4040/pyroscope/render?query=wall%3Acpu%3Ananoseconds%3Awall%3Ananoseconds%7Bservice_name%3D%22vt-graphd%22%7D&from=1&until=3&format=json',
  )
})

test('countTimelineSamples sums finite samples only', () => {
  assert.equal(countTimelineSamples({ timeline: { samples: [1, 2, Number.NaN, 4] } }), 7)
})

test('parseArgs validates required trace id and output format', () => {
  assert.throws(() => parseArgs([]), /--trace-id is required/)
  assert.throws(() => parseArgs(['--trace-id=abc', '--format=xml']), /--format/)
  assert.deepEqual(parseArgs(['--trace-id=abc', '--span-name=slow', '--padding-ms=10']).spanName, 'slow')
})
