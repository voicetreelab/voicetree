// Public barrel for @vt/vt-rpc. Consumers are the CLI client
// (webapp/.../daemon-client.ts, 9c), the graph-tools live client (9d), and
// the daemon itself (transport/portFile + transport/authToken re-export
// these helpers).

export {ERROR_CODES, type ErrorCode, type ErrorKindAlias} from './errorCodes.ts'

export {
    RPC_PORT_FILENAME,
    rpcPortFilePath,
    readRpcPortFile,
    writeRpcPortFile,
} from './portFile.ts'

export {
    AUTH_TOKEN_FILENAME,
    authTokenFilePath,
    readAuthTokenFile,
    redactToken,
    redactAuthorizationHeader,
} from './authTokenFile.ts'

export {
    generateAuthToken,
    writeAuthTokenFile,
} from './authTokenWrite.ts'

export {
    detectProjectFromCwd,
    discoverDaemonEndpoint,
    discoverDaemonEndpointForProject,
    type DiscoveryOptions,
    type ProjectDiscoveryOptions,
    type ResolvedDaemonEndpoint,
} from './pathDiscovery.ts'

export {
    createRpcClient,
    createRpcClientForProject,
    DaemonAuthRequired,
    DaemonUnreachable,
    type DaemonRpcClient,
    type CreateRpcClientOptions,
    type CreateRpcClientForProjectOptions,
    type JsonRpcResponse,
} from './httpClient.ts'
