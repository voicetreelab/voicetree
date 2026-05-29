import { SpanStatusCode, trace } from '@opentelemetry/api'
import { deletePortFile, writePortFile } from '../portFile.ts'

const tracer = trace.getTracer('vt-graphd')

export async function writeDaemonPortFile(
  project: string,
  port: number,
): Promise<void> {
  await tracer.startActiveSpan('daemon.write-port-file', async (span) => {
    try {
      await writePortFile(project, port)
      span.setAttribute('port', port)
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) })
      throw err
    } finally {
      span.end()
    }
  })
}

export async function deleteDaemonPortFile(project: string): Promise<void> {
  await deletePortFile(project)
}
