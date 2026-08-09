import SwiftUI

@main
struct RapidLogApp: App {
    @State private var viewModel = MenuBarViewModel()

    var body: some Scene {
        WindowGroup {
            ContentView(viewModel: viewModel)
        }
        .defaultSize(width: 520, height: 780)

        MenuBarExtra {
            MenuBarPopover(viewModel: viewModel)
        } label: {
            Text("●")
                .font(.system(size: 8))
        }
        .menuBarExtraStyle(.window)
    }
}
