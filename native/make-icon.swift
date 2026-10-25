import Cocoa
import Foundation

let side: CGFloat = 1024
let image = NSImage(size: NSSize(width: side, height: side), flipped: true) { rect in
  let shape = NSBezierPath(roundedRect: rect, xRadius: 226, yRadius: 226)
  shape.addClip()
  let wash = NSGradient(colors: [
    NSColor(calibratedRed: 0.96, green: 0.98, blue: 1, alpha: 1),
    NSColor(calibratedRed: 0.78, green: 0.86, blue: 0.99, alpha: 1),
    NSColor(calibratedRed: 0.55, green: 0.68, blue: 0.97, alpha: 1),
  ])!
  wash.draw(in: rect, angle: -90)

  NSGraphicsContext.current?.saveGraphicsState()
  let scale: CGFloat = 11.2
  let transform = NSAffineTransform()
  transform.translateX(by: 92, yBy: 250)
  transform.scale(by: scale)
  transform.concat()

  let tail = NSBezierPath()
  tail.move(to: NSPoint(x: 17, y: 25))
  tail.curve(to: NSPoint(x: 2, y: 16), controlPoint1: NSPoint(x: 11, y: 17), controlPoint2: NSPoint(x: 5, y: 14))
  tail.curve(to: NSPoint(x: 6, y: 25), controlPoint1: NSPoint(x: 4, y: 20), controlPoint2: NSPoint(x: 5, y: 22))
  tail.curve(to: NSPoint(x: 1, y: 36), controlPoint1: NSPoint(x: 5, y: 28), controlPoint2: NSPoint(x: 3, y: 32))
  tail.curve(to: NSPoint(x: 17, y: 28), controlPoint1: NSPoint(x: 5, y: 37), controlPoint2: NSPoint(x: 11, y: 33))
  tail.close()
  NSColor(calibratedRed: 0.62, green: 0.74, blue: 0.98, alpha: 1).setFill()
  tail.fill()

  let body = NSBezierPath()
  body.move(to: NSPoint(x: 64, y: 27))
  body.curve(to: NSPoint(x: 34, y: 12), controlPoint1: NSPoint(x: 61, y: 16), controlPoint2: NSPoint(x: 49, y: 10))
  body.curve(to: NSPoint(x: 15, y: 23), controlPoint1: NSPoint(x: 24, y: 13), controlPoint2: NSPoint(x: 18, y: 17))
  body.curve(to: NSPoint(x: 23, y: 37), controlPoint1: NSPoint(x: 13, y: 28), controlPoint2: NSPoint(x: 16, y: 34))
  body.curve(to: NSPoint(x: 59, y: 35), controlPoint1: NSPoint(x: 33, y: 42), controlPoint2: NSPoint(x: 51, y: 42))
  body.curve(to: NSPoint(x: 64, y: 27), controlPoint1: NSPoint(x: 63, y: 32), controlPoint2: NSPoint(x: 65, y: 29))
  body.close()
  NSColor(calibratedRed: 0.90, green: 0.95, blue: 1, alpha: 1).setFill()
  body.fill()
  NSColor(calibratedRed: 0.45, green: 0.58, blue: 0.95, alpha: 0.55).setStroke()
  body.lineWidth = 0.35
  body.stroke()

  let belly = NSBezierPath()
  belly.move(to: NSPoint(x: 21, y: 32))
  belly.curve(to: NSPoint(x: 57, y: 34), controlPoint1: NSPoint(x: 28, y: 42), controlPoint2: NSPoint(x: 48, y: 43))
  belly.curve(to: NSPoint(x: 21, y: 32), controlPoint1: NSPoint(x: 50, y: 42), controlPoint2: NSPoint(x: 30, y: 42))
  NSColor(calibratedWhite: 1, alpha: 0.92).setFill()
  belly.fill()

  NSColor(calibratedRed: 0.08, green: 0.12, blue: 0.28, alpha: 1).setFill()
  NSBezierPath(ovalIn: NSRect(x: 54.6, y: 23.4, width: 2.6, height: 2.6)).fill()
  NSColor.white.setFill()
  NSBezierPath(ovalIn: NSRect(x: 55.1, y: 23.8, width: 0.7, height: 0.7)).fill()

  NSGraphicsContext.current?.restoreGraphicsState()
  NSColor.black.setFill()
  NSBezierPath(ovalIn: NSRect(x: 132, y: 132, width: 108, height: 108)).fill()
  return true
}

guard let tiff = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let png = bitmap.representation(using: .png, properties: [:]) else {
  fputs("icon render failed\n", stderr)
  exit(1)
}
let url = URL(fileURLWithPath: CommandLine.arguments[1])
try png.write(to: url)
