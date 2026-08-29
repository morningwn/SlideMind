import { describe, expect, it } from 'vitest'
import { getTitleBarWindowOptions } from './window-options'

describe('getTitleBarWindowOptions', () => {
  it('reserves native traffic lights on macOS', () => {
    expect(getTitleBarWindowOptions('darwin')).toEqual({
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 15, y: 17 }
    })
  })

  it('uses the native window controls overlay on Windows', () => {
    expect(getTitleBarWindowOptions('win32')).toEqual({
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#f3f6fb',
        symbolColor: '#4f5d73',
        height: 46
      }
    })
  })
})
