import DisplayRefillCore
import DisplayRefillUI
import SwiftUI

@main
struct DisplayRefillApp: App {
    private let configuration = AppConfiguration.load(infoDictionary: Bundle.main.infoDictionary ?? [:])

    var body: some Scene {
        WindowGroup {
            AppRootView(configuration: configuration)
        }
    }
}
