import { getGraph } from '@vt/graph-model'
import { Hono } from 'hono'
import { GraphStateSchema } from '../contract.ts'

export function createGraphRoutes(): Hono {
  const app = new Hono()

  app.get('/', (c) => {
    const body = GraphStateSchema.parse(getGraph())
    return c.json(body)
  })

  return app
}
