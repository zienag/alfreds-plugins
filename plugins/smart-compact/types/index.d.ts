export type Focus = string | null

declare module 'claude-code' {
  interface PluginState {
    'smart-compact': {
      nudged: number
      focus: Focus
      resuming: string | null
    }
  }

  interface McpToolInputs {
    'mcp__smart-compact__compact_me': { focus: string }
  }
}
