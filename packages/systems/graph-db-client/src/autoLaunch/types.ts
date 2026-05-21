export interface EnsureDaemonResult {
  port: number
  pid: number | null
  launched: boolean
}
