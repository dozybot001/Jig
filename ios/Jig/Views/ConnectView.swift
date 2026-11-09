import SwiftUI

/// The first screen: what Jig is, and how this iPhone connects to Jig on the person's Mac.
struct ConnectView: View {
	@Environment(AppModel.self) private var model
	@State private var link = ""
	@State private var busy = false

	var body: some View {
		NavigationStack {
			Form {
				Section {
					VStack(spacing: 12) {
						JigMark()
							.frame(width: 56, height: 56)
							.accessibilityHidden(true)
						Text("Jig")
							.font(.title.weight(.semibold))
						Text("An AI-native multi-agent workbench")
							.font(.callout)
							.foregroundStyle(.secondary)
							.multilineTextAlignment(.center)
					}
					.frame(maxWidth: .infinity)
					.padding(.vertical, 12)
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
					Text("Debug builds only. Run `jig open` on the Mac and paste the link it prints.")
				}
				#endif
				if let problem = model.problem {
					Section {
						Text(problem).foregroundStyle(.red)
					}
				}
			}
		}
	}
}

/// Jig's mark: three parallel lines that form a J (web/public/icons/jig-mark.svg), in the text colour.
struct JigMark: View {
	var body: some View {
		GeometryReader { geometry in
			let scale = min(geometry.size.width, geometry.size.height) / 64
			Path { path in
				for (x, radius) in [(54.0, 22.0), (45.0, 13.0), (36.0, 4.0)] {
					path.move(to: CGPoint(x: x, y: 8))
					path.addLine(to: CGPoint(x: x, y: 34))
					path.addArc(
						center: CGPoint(x: 32, y: 34),
						radius: radius,
						startAngle: .degrees(0),
						endAngle: .degrees(180),
						clockwise: false
					)
				}
			}
			.applying(CGAffineTransform(scaleX: scale, y: scale))
			.stroke(.primary, style: StrokeStyle(lineWidth: 5 * scale, lineCap: .round))
		}
	}
}
