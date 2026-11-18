import AppKit

/// The window around the page looks like the page from the first moment, so starting does not
/// flash: its background is the page's, and when the person has chosen light or dark in
/// Personalization the app takes that instead of the system's and opens in it the next time, before
/// the page has loaded. The page says which through its `theme-color` (web/src/actions.ts): there
/// is one only while light or dark is chosen.
@MainActor
enum Appearance {
	private static let key = "pageAppearance"

	/// The page's background, `--bg` in web/src/styles/app.css.
	static let page = NSColor(name: nil) { appearance in
		appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
			? NSColor(srgbRed: 0x18 / 255, green: 0x18 / 255, blue: 0x18 / 255, alpha: 1)
			: NSColor(srgbRed: 1, green: 1, blue: 1, alpha: 1)
	}

	/// The appearance from last time, before any window opens.
	static func restore() {
		NSApp.appearance = named(UserDefaults.standard.string(forKey: key))
	}

	/// The page's `theme-color`: light or dark when the person chose one, nil when it follows the system.
	static func follow(_ color: NSColor?) {
		let name = color.map { isDark($0) ? "dark" : "light" }
		if let name {
			UserDefaults.standard.set(name, forKey: key)
		} else {
			UserDefaults.standard.removeObject(forKey: key)
		}
		NSApp.appearance = named(name)
	}

	private static func named(_ name: String?) -> NSAppearance? {
		switch name {
		case "dark": NSAppearance(named: .darkAqua)
		case "light": NSAppearance(named: .aqua)
		default: nil
		}
	}

	private static func isDark(_ color: NSColor) -> Bool {
		guard let rgb = color.usingColorSpace(.sRGB) else { return false }
		return 0.2126 * rgb.redComponent + 0.7152 * rgb.greenComponent + 0.0722 * rgb.blueComponent < 0.5
	}
}
