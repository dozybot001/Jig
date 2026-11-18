import SwiftUI

/// The first screen: what Yew is, and how this iPhone connects to Yew on the person's Mac.
struct ConnectView: View {
	@Environment(AppModel.self) private var model
	@State private var link = ""
	@State private var pairLink = ""
	@State private var busy = false
	@State private var scanning = false

	var body: some View {
		NavigationStack {
			Form {
				Section {
					VStack(spacing: 12) {
						// She says hello, and looks sorry while the last try to pair has failed.
						Mascot(pose: model.problem == nil ? .greeting : .sorry, height: 112)
						Lockup(size: 30)
						Text("An AI-native multi-agent workbench")
							.font(.callout)
							.foregroundStyle(.secondary)
							.multilineTextAlignment(.center)
					}
					.frame(maxWidth: .infinity)
					.padding(.vertical, 12)
				}
				Section {
					Button {
						scanning = true
					} label: {
						Label("Scan the QR code on your Mac", systemImage: "qrcode.viewfinder")
					}
					.disabled(!ScannerView.available || busy)
				} footer: {
					Text("In Yew Harness on your Mac, open Settings → Phone access, click Add phone, then scan the QR code it shows.")
				}
				Section("Or paste the pairing link") {
					TextField("yew://pair?…", text: $pairLink, axis: .vertical)
						.textInputAutocapitalization(.never)
						.autocorrectionDisabled()
					Button {
						pair(pairLink)
					} label: {
						if busy { ProgressView() } else { Text("Pair") }
					}
					.disabled(pairLink.isEmpty || busy)
				}
				Section {
					Button("Try the demo") { model.startDemo() }
						.disabled(busy)
				} footer: {
					Text("Look around with sample data, without a Mac.")
				}
				#if DEBUG
				Section {
					TextField("http://127.0.0.1:4791/#t=…", text: $link, axis: .vertical)
						.textInputAutocapitalization(.never)
						.autocorrectionDisabled()
						.keyboardType(.URL)
					Button {
						busy = true
						Task {
							await model.connectDirect(link: link)
							busy = false
						}
					} label: {
						if busy { ProgressView() } else { Text("Connect") }
					}
					.disabled(link.isEmpty || busy)
				} header: {
					Text("Connect to this Mac")
				} footer: {
					Text("Debug builds only. Run `yew open` on the Mac and paste the link it prints.")
				}
				#endif
				if let problem = model.problem {
					Section {
						Text(problem).foregroundStyle(.red)
					}
				}
				Section {
					NavigationLink("About Yew Harness") { AboutView() }
				}
			}
			.sheet(isPresented: $scanning) {
				ScannerView { code in
					scanning = false
					pair(code)
				}
				.ignoresSafeArea()
			}
		}
	}

	private func pair(_ text: String) {
		busy = true
		Task {
			await model.pair(with: text)
			busy = false
		}
	}
}

/// Yew's mark (web/public/icons/yew-mark.svg): a yew berry with its seed, and a leaf. The leaf is in the
/// ink colour, dark green in light mode and pale in dark mode; the berry and the seed keep their colours.
struct YewMark: View {
	var body: some View {
		ZStack {
			Part.leaf.fill(Color.yewInk)
			Part.berry.fill(Color(red: 200 / 255, green: 50 / 255, blue: 63 / 255))
			Part.seed.fill(Color(red: 31 / 255, green: 58 / 255, blue: 46 / 255))
		}
	}

	/// One piece of the mark, drawn in the SVG's 64-point square and scaled to fit the middle of the frame.
	private enum Part: Shape {
		case leaf, berry, seed

		func path(in rect: CGRect) -> Path {
			var path = Path()
			switch self {
			case .leaf:
				path.move(to: CGPoint(x: 35.4, y: 50.2))
				path.addCurve(to: CGPoint(x: 60, y: 12.6), control1: CGPoint(x: 36.6, y: 37.6), control2: CGPoint(x: 42.6, y: 22.6))
				path.addCurve(to: CGPoint(x: 49.4, y: 38.6), control1: CGPoint(x: 58.6, y: 24.4), control2: CGPoint(x: 55.2, y: 32.4))
				path.addCurve(to: CGPoint(x: 35.4, y: 50.2), control1: CGPoint(x: 45, y: 43.3), control2: CGPoint(x: 39.4, y: 46.4))
				path.closeSubpath()
			case .berry:
				path.addEllipse(in: CGRect(x: 19.8 - 15.9, y: 35.4 - 15.4, width: 2 * 15.9, height: 2 * 15.4))
			case .seed:
				// Turned 12° about its centre, as in the SVG.
				path.addEllipse(
					in: CGRect(x: -4.6, y: -3.1, width: 2 * 4.6, height: 2 * 3.1),
					transform: CGAffineTransform(translationX: 25.8, y: 22.6).rotated(by: 12 * .pi / 180)
				)
			}
			let scale = min(rect.width, rect.height) / 64
			return path.applying(
				CGAffineTransform(translationX: rect.midX - 32 * scale, y: rect.midY - 32 * scale).scaledBy(x: scale, y: scale)
			)
		}
	}
}

/// Yew's mascot, a red-haired girl with a yew-berry hair ornament (web/public/mascot), in one of her poses.
/// She is decoration only: VoiceOver skips her, and she never covers a control.
struct Mascot: View {
	/// The poses the app uses, by their image sets. All poses share one 373 × 400 canvas, so swapping one
	/// for another in the same place never moves anything.
	enum Pose: String {
		case greeting = "MascotGreeting"
		case happy = "MascotHappy"
		case sorry = "MascotSorry"
		case gift = "MascotGift"
	}

	let pose: Pose
	var height: CGFloat = 110

	var body: some View {
		Image(pose.rawValue)
			.renderingMode(.original)
			.resizable()
			.frame(width: height * 373 / 400, height: height)
			.accessibilityHidden(true)
	}
}
