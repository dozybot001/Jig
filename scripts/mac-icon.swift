// Draws the icon of Jig's launcher app for macOS: the J of three parallel lines, near black, on a
// white rounded square with the margins macOS icons keep. Run once when the mark changes:
//   swift scripts/mac-icon.swift web/public/icons/app-icon.png
import AppKit

let size = 1024.0
let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "app-icon.png"
let space = CGColorSpace(name: CGColorSpace.sRGB)!
let context = CGContext(
	data: nil, width: Int(size), height: Int(size), bitsPerComponent: 8, bytesPerRow: 0, space: space,
	bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
// Work with the origin at the top left, as the mark's SVG does.
context.translateBy(x: 0, y: size)
context.scaleBy(x: 1, y: -1)

// The plate: 824 of 1024, as Apple's icon grid has it, with a soft shadow and a hairline edge so
// it reads on a light Dock.
let plate = CGRect(x: 100, y: 100, width: 824, height: 824)
let shape = CGPath(roundedRect: plate, cornerWidth: 185, cornerHeight: 185, transform: nil)
context.saveGState()
context.setShadow(offset: CGSize(width: 0, height: -10), blur: 24, color: CGColor(gray: 0, alpha: 0.28))
context.setFillColor(CGColor(gray: 1, alpha: 1))
context.addPath(shape)
context.fillPath()
context.restoreGState()
context.setStrokeColor(CGColor(gray: 0, alpha: 0.1))
context.setLineWidth(2)
context.addPath(shape)
context.strokePath()

// The mark, from web/public/icons/jig-mark.svg (viewBox 64): three strokes of width 5, round caps,
// each a line down from y 8 to y 34 and a half circle around (32, 34) to the left.
let scale = 7.6
context.translateBy(x: (size - 64 * scale) / 2, y: (size - 64 * scale) / 2)
context.scaleBy(x: scale, y: scale)
context.setStrokeColor(CGColor(srgbRed: 0.05, green: 0.05, blue: 0.05, alpha: 1))
context.setLineWidth(5)
context.setLineCap(.round)
for radius in [22.0, 13.0, 4.0] {
	context.move(to: CGPoint(x: 32 + radius, y: 8))
	context.addLine(to: CGPoint(x: 32 + radius, y: 34))
	context.addArc(center: CGPoint(x: 32, y: 34), radius: radius, startAngle: 0, endAngle: .pi, clockwise: false)
	context.strokePath()
}

let image = NSBitmapImageRep(cgImage: context.makeImage()!)
try image.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))
print("wrote \(out)")
