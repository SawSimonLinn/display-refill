import Foundation
import Testing
@testable import DisplayRefillCore

/// Feature 16 against a LOCAL stack: sign-up, the code from Mailpit, access code, create a store,
/// pick display cases, and Stock Check sections. Opt-in: DISPLAY_REFILL_LIVE_ONBOARDING=1 plus
/// LIVE_API_BASE_URL, LIVE_SUPABASE_URL, LIVE_PUBLISHABLE_KEY, LIVE_MAILPIT_URL, LIVE_ACCESS_CODE.
private let env = ProcessInfo.processInfo.environment

@Suite(.enabled(if: env["DISPLAY_REFILL_LIVE_ONBOARDING"] == "1"), .serialized)
struct LiveOnboardingTests {
    let apiURL = URL(string: env["LIVE_API_BASE_URL"] ?? "http://localhost:3100")!
    let supabaseURL = URL(string: env["LIVE_SUPABASE_URL"] ?? "http://127.0.0.1:54321")!
    let mailpitURL = URL(string: env["LIVE_MAILPIT_URL"] ?? "http://127.0.0.1:54324")!
    let key = env["LIVE_PUBLISHABLE_KEY"] ?? ""
    let accessCode = env["LIVE_ACCESS_CODE"] ?? ""

    init() throws {
        for host in [apiURL.host(), supabaseURL.host(), mailpitURL.host()] {
            try #require(["localhost", "127.0.0.1"].contains(host ?? ""), "live tests run against loopback only")
        }
    }

    /// Latest 6-digit code emailed to `email` (Mailpit search, newest first).
    private func code(for email: String) async throws -> String {
        for _ in 0..<40 {
            var search = URLComponents(url: mailpitURL.appending(path: "api/v1/search"), resolvingAgainstBaseURL: false)!
            search.queryItems = [URLQueryItem(name: "query", value: "to:\"\(email)\"")]
            let (data, _) = try await URLSession.shared.data(from: search.url!)
            if let id = ((try JSONSerialization.jsonObject(with: data) as? [String: Any])?["messages"] as? [[String: Any]])?.first?["ID"] as? String {
                let (message, _) = try await URLSession.shared.data(from: mailpitURL.appending(path: "api/v1/message/\(id)"))
                let html = ((try JSONSerialization.jsonObject(with: message) as? [String: Any])?["HTML"] as? String) ?? ""
                if let range = html.range(of: #"\b\d{6}\b"#, options: .regularExpression) { return String(html[range]) }
            }
            try await Task.sleep(for: .milliseconds(250))
        }
        throw URLError(.timedOut)
    }

    @Test func newAccountCreatesAStoreAndCountsOnlyChosenCases() async throws {
        let transport = URLSessionTransport()
        let auth = SupabaseAuthClient(supabaseURL: supabaseURL, publishableKey: key, transport: transport)
        let sessions = SessionManager(auth: auth, store: InMemorySessionStore())
        let api = URLSessionAccountAPI(baseURL: apiURL, sessions: sessions, transport: transport)
        let email = "ios-onboard-\(UUID().uuidString.prefix(8).lowercased())@example.com"

        try await auth.signUp(email: email, password: "ios-live-password-\(UUID().uuidString.prefix(6))", displayName: "iOS live")
        await #expect(throws: AuthError.invalidCode) { _ = try await auth.verifySignUpCode(email: email, code: "000000") }
        await sessions.adopt(try await auth.verifySignUpCode(email: email, code: try await code(for: email)))

        await #expect(throws: APIClientError.self) { _ = try await api.me() }
        #expect(try await api.onboardingStatus().state == .accessCode)
        #expect(try await api.joinOrganization(accessCode: accessCode).state == .store)

        let number = "IOS-\(UUID().uuidString.prefix(6))"
        let store = try await api.joinStore(number: number, name: "iOS live store", timezone: "America/Los_Angeles")
        #expect(store.created && store.role == "manager")
        #expect(try await api.me().stores.map { $0.storeNumber } == [number])

        let cases = try await api.storeDisplayCases(storeID: store.store.store_id)
        #expect(cases.can_manage && cases.sections.allSatisfy(\.selected))
        let chosen = cases.sections.filter { $0.code == "fruit_case" || $0.code == "salad_mobile" }.map(\.id)
        let saved = try await api.setStoreDisplayCases(storeID: store.store.store_id, typeIDs: chosen)
        #expect(saved.sections.filter(\.selected).map(\.code) == ["salad_mobile", "fruit_case"])

        let worksheet = await ProductionWorksheet(api: api, storeID: store.store.store_id)
        await worksheet.load()
        #expect(await worksheet.sections == [.saladMobile, .fruitCase])
        #expect(await worksheet.section(after: .saladMobile) == .fruitCase)
    }
}
