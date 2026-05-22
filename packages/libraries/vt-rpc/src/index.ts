// Public barrel for @vt/vt-rpc. Consumers are the CLI client
// (webapp/.../daemon-client.ts, 9c), the graph-tools live client (9d), and
// the daemon itself (transport/portFile + transport/authToken re-export
// these helpers).

export {ERROR_CODES, type ErrorCode, type ErrorKindAlias} from './errorCodes.ts'

export {
    VOICETREE_DIRNAME,
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
    detectVaultFromCwd,
    discoverDaemonEndpoint,
    type DiscoveryOptions,
    type ResolvedDaemonEndpoint,
} from './pathDiscovery.ts'

export {
    createRpcClient,
    DaemonAuthRequired,
    DaemonUnreachable,
    type DaemonRpcClient,
    type CreateRpcClientOptions,
    type JsonRpcResponse,
} from './httpClient.ts'
