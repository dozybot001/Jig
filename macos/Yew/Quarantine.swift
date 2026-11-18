import CoreServices
import Foundation

/// Marks a file as downloaded (the com.apple.quarantine attribute), as a browser does with what it
/// saves, so macOS checks the file (Gatekeeper) before it is opened. The window app also declares
/// LSFileQuarantineEnabled in its Info.plist; this marks the files WebKit writes for it explicitly.
enum Quarantine {
	static func mark(_ file: URL, from source: URL?) {
		var properties: [String: Any] = [
			kLSQuarantineTypeKey as String: kLSQuarantineTypeWebDownload as String,
			kLSQuarantineAgentNameKey as String: "Yew Harness",
		]
		if let source, source.scheme == "http" {
			properties[kLSQuarantineDataURLKey as String] = source
		}
		var values = URLResourceValues()
		values.quarantineProperties = properties
		var target = file
		try? target.setResourceValues(values)
	}
}
