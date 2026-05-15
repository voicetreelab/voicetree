import type { Command } from '../domain/command.ts'
import type { Session } from '../domain/session.ts'

export type LayoutUpdate = {
  positions?: Session['layout']['positions']
  pan?: Session['layout']['pan']
  zoom?: number
}

export function handleLayout(
  session: Session,
  update: LayoutUpdate,
): {
  session: Session
  commands: Command[]
  response: { layout: Session['layout'] }
} {
  const nextLayout = {
    positions:
      update.positions === undefined
        ? session.layout.positions
        : {
            ...session.layout.positions,
            ...update.positions,
          },
    pan: update.pan ?? session.layout.pan,
    zoom: update.zoom ?? session.layout.zoom,
  }

  return {
    session: { ...session, layout: nextLayout },
    commands: [{ type: 'RegistryTouch', sessionId: session.id }],
    response: { layout: nextLayout },
  }
}
