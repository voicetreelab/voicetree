import { closeSync, fsyncSync, openSync, writeSync } from 'node:fs'

function writeAllSync(fd, text) {
  const buffer = Buffer.from(text)
  let offset = 0

  while (offset < buffer.byteLength) {
    offset += writeSync(fd, buffer, offset, buffer.byteLength - offset)
  }
}

export function createDurableLineLog(path) {
  const fd = openSync(path, 'a')
  let closed = false

  const writeLine = (line) => {
    if (closed) throw new Error(`durable log is closed: ${path}`)
    writeAllSync(fd, `${line}\n`)
    fsyncSync(fd)
  }

  const close = () => {
    if (closed) return
    closed = true
    closeSync(fd)
  }

  return { writeLine, close }
}
