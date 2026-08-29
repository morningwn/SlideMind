import type { BrowserWindowConstructorOptions } from 'electron'

type TitleBarWindowOptions = Pick<
  BrowserWindowConstructorOptions,
  'autoHideMenuBar' | 'titleBarOverlay' | 'titleBarStyle' | 'trafficLightPosition'
>

const TITLE_BAR_HEIGHT = 46

export function getTitleBarWindowOptions(platform: NodeJS.Platform): TitleBarWindowOptions {
  if (platform === 'darwin') {
    return {
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 15, y: 17 }
    }
  }

  return {
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#f3f6fb',
      symbolColor: '#4f5d73',
      height: TITLE_BAR_HEIGHT
    }
  }
}
