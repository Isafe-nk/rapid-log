import SwiftUI

struct TaskItem: Codable, Identifiable {
    let id: String
    let text: String
    let completed: Bool
    let type: String        // "task" | "event" | "note"
    let timeOfDay: String   // "morning" | "noon" | "night"
    let time: String?
    let endTime: String?
    let priority: Bool
    let createdAt: Double
}

@Observable
class MenuBarViewModel {
    var tasks: [TaskItem] = []

    var activeTasks: [TaskItem] {
        tasks.filter { !$0.completed }
    }

    var completedTasks: [TaskItem] {
        tasks.filter { $0.completed }
    }

    var activeCount: Int { activeTasks.count }
    var completedCount: Int { completedTasks.count }
    var totalCount: Int { tasks.count }

    func tasksForSection(_ section: String) -> [TaskItem] {
        activeTasks
            .filter { $0.timeOfDay == section }
            .sorted { $0.createdAt < $1.createdAt }
    }

    func updateFromJSON(_ jsonString: String) {
        guard let data = jsonString.data(using: .utf8) else { return }
        do {
            let decoded = try JSONDecoder().decode([TaskItem].self, from: data)
            tasks = decoded
        } catch {
            print("[RapidLog] Failed to decode tasks: \(error)")
        }
    }
}
