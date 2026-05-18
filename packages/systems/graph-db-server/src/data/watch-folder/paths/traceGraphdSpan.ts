import { trace, SpanStatusCode, type Span } from '@opentelemetry/api';

const tracer = trace.getTracer('vt-graphd');

export async function traceGraphdSpan<T>(
    name: string,
    operation: (span: Span) => Promise<T>,
): Promise<T> {
    return await tracer.startActiveSpan(name, async (span: Span): Promise<T> => {
        try {
            return await operation(span);
        } catch (err) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
            throw err;
        } finally {
            span.end();
        }
    });
}
