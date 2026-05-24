import net from 'node:net'

export async function isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const server: net.Server = net.createServer()

        server.once('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') {
                resolve(false)
            } else {
                resolve(false)
            }
        })

        server.once('listening', () => {
            server.close()
            resolve(true)
        })

        server.listen(port, '127.0.0.1')
    })
}

export async function findAvailablePort(startPort: number): Promise<number> {
    let port: number = startPort
    const maxAttempts: 100 = 100 as const

    for (let i: number = 0; i < maxAttempts; i++) {
        const isAvailable: boolean = await isPortAvailable(port)
        if (isAvailable) {
            return port
        }
        port++
    }

    throw new Error(`No available ports found from ${startPort} to ${port - 1}`)
}
