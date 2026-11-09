import SwiftUI
import VisionKit

/// The camera, looking for Jig's pairing QR code; reports the first one it sees.
struct ScannerView: UIViewControllerRepresentable {
	let onCode: (String) -> Void

	static var available: Bool {
		DataScannerViewController.isSupported && DataScannerViewController.isAvailable
	}

	func makeUIViewController(context: Context) -> DataScannerViewController {
		let scanner = DataScannerViewController(
			recognizedDataTypes: [.barcode(symbologies: [.qr])],
			qualityLevel: .balanced,
			isHighlightingEnabled: true
		)
		scanner.delegate = context.coordinator
		return scanner
	}

	func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
		if !scanner.isScanning { try? scanner.startScanning() }
	}

	func makeCoordinator() -> Coordinator {
		Coordinator(onCode: onCode)
	}

	@MainActor
	final class Coordinator: NSObject, DataScannerViewControllerDelegate {
		let onCode: (String) -> Void
		private var done = false

		init(onCode: @escaping (String) -> Void) {
			self.onCode = onCode
		}

		func dataScanner(_ scanner: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
			guard !done else { return }
			for item in items {
				if case .barcode(let code) = item, let value = code.payloadStringValue, value.hasPrefix("jig://pair?") {
					done = true
					scanner.stopScanning()
					onCode(value)
					return
				}
			}
		}
	}
}
