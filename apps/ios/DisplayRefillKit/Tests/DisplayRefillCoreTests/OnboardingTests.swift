import Foundation
import Testing
@testable import DisplayRefillCore

// Feature 16: sign-up with an email code, onboarding API and server-defined sections.

private let supabaseURL = URL(string: "http://127.0.0.1:54321")!
private let apiURL = URL(string: "http://localhost:3000")!
private let userID = UUID(uuidString: "6f0a3c1e-1111-4111-8111-111111111111")!
private let envelope = #""request_id":"0b0e7a9c-3f0e-4c7a-9a39-5b1f8a3c2d10""#

private func body(_ request: URLRequest) -> [String: Any] {
    (try? JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any]) ?? [:]
}

private func signedIn(_ handler: @escaping StubTransport.Handler) -> (StubTransport, URLSessionAccountAPI) {
    let transport = StubTransport(handler)
    let saved = AuthSession(accessToken: "a1", refreshToken: "r1", expiresAt: Date().addingTimeInterval(3600), userID: userID, email: "e@example.com")
    let sessions = SessionManager(auth: SupabaseAuthClient(supabaseURL: supabaseURL, publishableKey: "sb_publishable_test", transport: transport), store: InMemorySessionStore(saved))
    return (transport, URLSessionAccountAPI(baseURL: apiURL, sessions: sessions, transport: transport))
}

@Suite struct SignUpTests {
    @Test func signUpSendsNameAsMetadataAndOnlyThePublicKey() async throws {
        let transport = StubTransport { _ in .success((200, #"{"id":"6f0a3c1e-1111-4111-8111-111111111111","email":"new@example.com"}"#)) }
        let auth = SupabaseAuthClient(supabaseURL: supabaseURL, publishableKey: "sb_publishable_test", transport: transport)
        try await auth.signUp(email: "new@example.com", password: "a-long-password-1", displayName: "Sam")
        let request = try #require(transport.requests.first)
        #expect(request.url?.absoluteString == "http://127.0.0.1:54321/auth/v1/signup")
        #expect(request.value(forHTTPHeaderField: "apikey") == "sb_publishable_test")
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
        #expect((body(request)["data"] as? [String: String]) == ["display_name": "Sam"])
    }

    @Test func weakPasswordAndRateLimitAreDistinct() async {
        let weak = SupabaseAuthClient(supabaseURL: supabaseURL, publishableKey: "k", transport: StubTransport { _ in .success((422, #"{"code":422,"error_code":"weak_password","msg":"weak"}"#)) })
        await #expect(throws: AuthError.weakPassword) { try await weak.signUp(email: "n@example.com", password: "short", displayName: "N") }
        let other = SupabaseAuthClient(supabaseURL: supabaseURL, publishableKey: "k", transport: StubTransport { _ in .success((422, #"{"error_code":"validation_failed"}"#)) })
        await #expect(throws: AuthError.signUpRejected) { try await other.signUp(email: "bad", password: "a-long-password-1", displayName: "N") }
        let limited = SupabaseAuthClient(supabaseURL: supabaseURL, publishableKey: "k", transport: StubTransport { _ in .success((429, "{}")) })
        await #expect(throws: AuthError.rateLimited) { try await limited.signUp(email: "n@example.com", password: "a-long-password-1", displayName: "N") }
    }

    @Test func verifiedCodeBecomesTheSavedSession() async throws {
        let expires = Int(Date().addingTimeInterval(3600).timeIntervalSince1970)
        let transport = StubTransport { request in
            request.url?.path == "/auth/v1/verify"
                ? .success((200, #"{"access_token":"a9","refresh_token":"r9","expires_at":\#(expires),"user":{"id":"\#(userID.uuidString.lowercased())","email":"new@example.com"}}"#))
                : .success((400, "{}"))
        }
        let auth = SupabaseAuthClient(supabaseURL: supabaseURL, publishableKey: "k", transport: transport)
        let session = try await auth.verifySignUpCode(email: "new@example.com", code: "123456")
        #expect(body(try #require(transport.requests.first)) as? [String: String] == ["type": "email", "email": "new@example.com", "token": "123456"])
        let store = InMemorySessionStore()
        let manager = SessionManager(auth: auth, store: store)
        await manager.adopt(session)
        #expect(try store.load()?.accessToken == "a9")
        #expect(try await manager.validAccessToken() == "a9")
    }

    @Test func wrongCodeIsInvalidCode() async {
        let auth = SupabaseAuthClient(supabaseURL: supabaseURL, publishableKey: "k", transport: StubTransport { _ in .success((403, #"{"error_code":"otp_expired"}"#)) })
        await #expect(throws: AuthError.invalidCode) { _ = try await auth.verifySignUpCode(email: "n@example.com", code: "000000") }
    }
}

@Suite struct OnboardingAPITests {
    @Test func statusJoinAndStoreUseTheDocumentedRoutes() async throws {
        let (transport, api) = signedIn { request in
            switch (request.httpMethod, request.url?.path) {
            case ("GET", "/api/v1/onboarding"): .success((200, #"{"data":{"state":"access_code","organization":null,"stores":[]},\#(envelope)}"#))
            case ("POST", "/api/v1/onboarding/join"): .success((200, #"{"data":{"state":"store","organization":{"organization_id":"o","name":"Supreme","role":"member"},"stores":[]},\#(envelope)}"#))
            case ("POST", "/api/v1/onboarding/store"): .success((200, #"{"data":{"created":true,"role":"manager","store":{"store_id":"s1","organization_id":"o","name":"FM 615","store_number":"615","timezone":"America/Los_Angeles"}},\#(envelope)}"#))
            default: .success((404, "{}"))
            }
        }
        #expect(try await api.onboardingStatus().state == .accessCode)
        let joined = try await api.joinOrganization(accessCode: "abcd-efgh")
        #expect(joined.state == .store)
        #expect(joined.organization?.name == "Supreme")
        let store = try await api.joinStore(number: "615", name: "FM 615", timezone: "America/Los_Angeles")
        #expect(store.created && store.role == "manager")
        #expect(body(transport.requests[1]) as? [String: String] == ["access_code": "abcd-efgh"])
        #expect(body(transport.requests[2]) as? [String: String] == ["store_number": "615", "name": "FM 615", "timezone": "America/Los_Angeles"])
        #expect(transport.requests.allSatisfy { $0.value(forHTTPHeaderField: "Authorization") == "Bearer a1" })
    }

    @Test func joiningAStoreSendsOnlyTheNumber() async throws {
        let (transport, api) = signedIn { _ in .success((200, #"{"data":{"created":false,"role":"employee","store":{"store_id":"s1","organization_id":"o","name":"FM 615","store_number":"615","timezone":"UTC"}},\#(envelope)}"#)) }
        _ = try await api.joinStore(number: "615", name: nil, timezone: nil)
        #expect(body(try #require(transport.requests.first)) as? [String: String] == ["store_number": "615"])
    }

    @Test func wrongCodeIsAValidationFailure() async {
        let (_, api) = signedIn { _ in .success((422, #"{"error":{"code":"VALIDATION_FAILED","message":"The request contains invalid values.","field_errors":{"access_code":["That access code is not valid."]}},\#(envelope)}"#)) }
        await #expect(throws: APIClientError.self) { _ = try await api.joinOrganization(accessCode: "nope-nope") }
    }

    @Test func displayCasesReadAndSaveKeepServerOrder() async throws {
        let config = #"{"data":{"can_manage":true,"items":[],"sections":[{"id":"t1","code":"fruit_mobile","name":"M1 Bunker (Fruit)","family":"Fruit","selected":true},{"id":"t2","code":"cold_case","name":"Cold Case","family":"Salads","selected":false}]},\#(envelope)}"#
        let (transport, api) = signedIn { _ in .success((200, config)) }
        let cases = try await api.storeDisplayCases(storeID: "s1")
        #expect(cases.sections.map(\.code) == ["fruit_mobile", "cold_case"])
        #expect(cases.sections.map(\.selected) == [true, false])
        _ = try await api.setStoreDisplayCases(storeID: "s1", typeIDs: ["t1", "t2"])
        let put = try #require(transport.requests.last)
        #expect(put.httpMethod == "PUT")
        #expect(put.url?.path == "/api/v1/stores/s1/display-types")
        #expect((body(put)["display_type_ids"] as? [String]) == ["t1", "t2"])
    }
}

@Suite struct DynamicSectionTests {
    @Test func unknownTypeCodesDecodeAndUseServerNames() throws {
        let json = #"{"date":"2026-10-07","total_make":0,"complete":false,"sections":[{"section":"fruit_mobile","name":"M1 Bunker (Fruit)","check_id":null,"finished_at":null,"in_progress":false,"items":[],"total_make":null},{"section":"cold_case","name":"Cold Case","check_id":null,"finished_at":null,"in_progress":false,"items":[],"total_make":null}]}"#
        let day = try JSONDecoder().decode(ProductionDay.self, from: Data(json.utf8))
        #expect(day.sections.map(\.section) == [.fruitMobile, ProductionSection(rawValue: "cold_case")])
        // Standard sections keep their established labels; others use the server's name.
        #expect(day.sections[0].section.label(named: day.sections[0].name) == "M1 BUNKER (FRUIT)")
        #expect(day.sections[1].section.label(named: day.sections[1].name) == "Cold Case")
        #expect(ProductionSection(rawValue: "cold_case").label == "Cold Case")
        #expect(PrepPresentation.locationLabel(ProductionSection(rawValue: "cold_case")) == "Cold Case")
    }

    @Test func olderServersWithoutNamesStillDecode() throws {
        let json = #"{"date":"2026-10-07","total_make":0,"complete":false,"sections":[{"section":"veggie_case","check_id":null,"finished_at":null,"items":[],"total_make":null}]}"#
        let day = try JSONDecoder().decode(ProductionDay.self, from: Data(json.utf8))
        #expect(day.sections[0].name == nil)
        #expect(day.sections[0].section.label(named: nil) == "Veggie display case")
    }

    @Test @MainActor func sectionsAndNextSectionFollowTheStore() async {
        let day = try! JSONDecoder().decode(ProductionDay.self, from: Data(#"{"date":"2026-10-07","total_make":0,"complete":false,"sections":[{"section":"fruit_case","name":"6ft Fruit","items":[]},{"section":"cold_case","name":"Cold Case","items":[]}]}"#.utf8))
        let model = ProductionWorksheet(api: FixedDayAPI(day: day), storeID: "s1")
        #expect(model.sections == ProductionSection.standard)
        await model.load()
        #expect(model.sections.map(\.rawValue) == ["fruit_case", "cold_case"])
        #expect(model.section(after: .fruitCase)?.rawValue == "cold_case")
        #expect(model.section(after: ProductionSection(rawValue: "cold_case")) == nil)
        #expect(model.label(ProductionSection(rawValue: "cold_case")) == "Cold Case")
    }
}

private struct FixedDayAPI: ProductionAPI {
    let day: ProductionDay
    func productionDay(storeID: String) async throws -> ProductionDay { day }
    func productionCheck(storeID: String, checkID: String) async throws -> ProductionCheck { throw URLError(.badURL) }
    func productionMutate(storeID: String, mutation: ProductionMutation, key: String) async throws -> ProductionCheck { throw URLError(.badURL) }
}
