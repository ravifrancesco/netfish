import Foundation

/// Where the Netfish server is. The app remembers only this; everything else
/// comes from the server, so updating the container updates the app too.
enum Server {
    private static let key = "server"

    static var url: URL? {
        get { UserDefaults.standard.string(forKey: key).flatMap(URL.init(string:)) }
        set { UserDefaults.standard.set(newValue?.absoluteString, forKey: key) }
    }

    /// True when `url` is on the saved server (same scheme, host and port).
    static func owns(_ url: URL?) -> Bool {
        guard let url, let server = Server.url else { return false }
        return url.scheme == server.scheme && url.host == server.host && url.port == server.port
    }

    /// "192.168.1.50" → http://192.168.1.50:7777. Real domains keep their own port.
    static func normalize(_ input: String) throws -> URL {
        var value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { throw Problem("Enter the address of your Netfish server") }
        if value.range(of: "^https?://", options: [.regularExpression, .caseInsensitive]) == nil { value = "http://" + value }
        guard var parts = URLComponents(string: value), let host = parts.host, !host.isEmpty else {
            throw Problem("That doesn't look like an address")
        }
        let scheme = (parts.scheme ?? "http").lowercased()
        let local = host.range(of: #"^\d{1,3}(\.\d{1,3}){3}$"#, options: .regularExpression) != nil || host.hasSuffix(".local") || !host.contains(".")
        if parts.port == nil && scheme == "http" && local { parts.port = 7777 }
        parts.scheme = scheme
        parts.path = ""
        parts.query = nil
        parts.fragment = nil
        guard let url = parts.url else { throw Problem("That doesn't look like an address") }
        return url
    }

    /// Make sure the address really is a Netfish server before saving it.
    static func probe(_ origin: URL) async throws {
        var request = URLRequest(url: origin.appendingPathComponent("api/health"))
        request.timeoutInterval = 6
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw Problem("Can't reach \(origin.absoluteString) (\(error.localizedDescription))")
        }
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        guard (response as? HTTPURLResponse)?.statusCode == 200, json?["name"] as? String == "netfish" else {
            throw Problem("\(origin.absoluteString) doesn't look like a Netfish server")
        }
    }
}

/// An error whose message is shown to people as-is.
struct Problem: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
