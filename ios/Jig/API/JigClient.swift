import Foundation

/// Where the app's requests go. The relay channel (M3 plan, sections 4 and 7) and, in Debug builds, a
/// direct connection to `jig serve` on this Mac (the simulator shares the Mac's network).
protocol Transport: Sendable {
	func send(method: String, path: String, body: Data?) async throws -> (Data, Int)
}

/// Debug only: talks to `jig serve` on 127.0.0.1 with the cookie a `jig open` link was exchanged for.
struct DirectTransport: Transport {
	let base: URL

	/// Jig accepts writes only from its own origin.
	private var origin: String {
		"\(base.scheme ?? "http")://\(base.host() ?? "127.0.0.1"):\(base.port ?? 80)"
	}

	func send(method: String, path: String, body: Data?) async throws -> (Data, Int) {
		guard let url = URL(string: path, relativeTo: base) else { throw URLError(.badURL) }
		var request = URLRequest(url: url)
		request.httpMethod = method
		request.httpBody = body
		request.setValue("application/json", forHTTPHeaderField: "Content-Type")
		if method != "GET" { request.setValue(origin, forHTTPHeaderField: "Origin") }
		let (data, response) = try await URLSession.shared.data(for: request)
		return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
	}
}

struct JigClient: Sendable {
	let transport: any Transport

	func get<Value: Decodable & Sendable>(_ path: String, as type: Value.Type = Value.self) async throws -> Value {
		let data = try await call("GET", path, body: nil)
		return try JSONDecoder().decode(Value.self, from: data)
	}

	@discardableResult
	func post(_ path: String, _ payload: some Encodable & Sendable) async throws -> Data {
		try await call("POST", path, body: JSONEncoder().encode(payload))
	}

	private func call(_ method: String, _ path: String, body: Data?) async throws -> Data {
		let (data, status) = try await transport.send(method: method, path: path, body: body)
		guard (200..<300).contains(status) else {
			throw (try? JSONDecoder().decode(JigProblem.self, from: data))
				?? JigProblem(title: "HTTP \(status)", detail: nil)
		}
		return data
	}
}

extension JigClient {
	/// Debug only: trades the one-time token of a `jig open` link for the browser cookie.
	static func direct(link: String) async throws -> (JigClient, URL) {
		guard let url = URL(string: link.trimmingCharacters(in: .whitespacesAndNewlines)),
			let host = url.host(), let fragment = url.fragment(), fragment.hasPrefix("t=")
		else {
			throw JigProblem(title: String(localized: "Paste the whole link that `jig open` prints."), detail: nil)
		}
		var parts = URLComponents()
		parts.scheme = url.scheme ?? "http"
		parts.host = host
		parts.port = url.port
		guard let base = parts.url else { throw URLError(.badURL) }
		let client = JigClient(transport: DirectTransport(base: base))
		try await client.post("/api/auth/exchange", ["token": String(fragment.dropFirst(2))])
		return (client, base)
	}
}
