const SHORT = /^#([0-9a-fA-F]{3})$/

export type Rgba = [number, number, number, number]

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

export function parseHexColor(hex: string): Rgba {
  if (!HEX.test(hex)) {
    return [0, 0, 0, 0]
  }

  const short = SHORT.exec(hex)
  const body = short?.[1] ? short[1].split('').map((c) => c + c).join('') : hex.slice(1)

  const value = (offset: number): number => parseInt(body.slice(offset, offset + 2), 16) / 255

  return [value(0), value(2), value(4), body.length === 8 ? value(6) : 1]
}
