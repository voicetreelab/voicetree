export interface Settings {
  agentLaunchPath: string;
  agentCommand: string;
}

export const DEFAULT_SETTINGS: Settings = {
  agentLaunchPath: '../',
  agentCommand: './Claude.sh'
};
