export const PI_WEB_TOOL_NAMES = [
  'web_search',
  'source_check',
  'fetch_content',
  'get_search_content',
] as const

export const PI_AGENT_TOOL_NAMES = [
  ...PI_WEB_TOOL_NAMES,
  'download_asset',
] as const
