import {dirname, join} from 'node:path'

export const TMUX_LAUNCH_AGENT_LABEL: string = 'com.voicetree.tmux'

const ROOT_SESSION: string = '__voicetree_root__'

export interface RenderPlistOptions {
    readonly label?: string
    readonly logDir?: string
    readonly socketPath: string
    readonly tmuxBin: string
}

function escapeXml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
}

export function renderPlist(options: RenderPlistOptions): string {
    const label: string = options.label ?? TMUX_LAUNCH_AGENT_LABEL
    const logDir: string = options.logDir ?? dirname(options.socketPath)
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(options.tmuxBin)}</string>
    <string>-S</string><string>${escapeXml(options.socketPath)}</string>
    <string>-f</string><string>/dev/null</string>
    <string>new-session</string><string>-d</string>
    <string>-s</string><string>${escapeXml(ROOT_SESSION)}</string>
    <string>--</string><string>sleep</string><string>infinity</string>
  </array>
  <key>ProcessType</key><string>Interactive</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${escapeXml(join(logDir, 'tmux-server.out.log'))}</string>
  <key>StandardErrorPath</key><string>${escapeXml(join(logDir, 'tmux-server.err.log'))}</string>
</dict>
</plist>
`
}
