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

    enum CodingKeys: String, CodingKey {
        case id, text, completed, type, timeOfDay, time, endTime, priority, createdAt
    }

    init(id: String, text: String, completed: Bool, type: String, timeOfDay: String, time: String?, endTime: String?, priority: Bool, createdAt: Double) {
        self.id = id
        self.text = text
        self.completed = completed
        self.type = type
        self.timeOfDay = timeOfDay
        self.time = time
        self.endTime = endTime
        self.priority = priority
        self.createdAt = createdAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        text = try container.decodeIfPresent(String.self, forKey: .text) ?? ""
        completed = try container.decodeIfPresent(Bool.self, forKey: .completed) ?? false
        type = try container.decodeIfPresent(String.self, forKey: .type) ?? "task"
        timeOfDay = try container.decodeIfPresent(String.self, forKey: .timeOfDay) ?? "morning"
        time = try container.decodeIfPresent(String.self, forKey: .time)
        endTime = try container.decodeIfPresent(String.self, forKey: .endTime)
        priority = try container.decodeIfPresent(Bool.self, forKey: .priority) ?? false
        createdAt = try container.decodeIfPresent(Double.self, forKey: .createdAt) ?? Date().timeIntervalSince1970 * 1000
    }
}

class MenuBarViewModel: ObservableObject {
    @Published var tasks: [TaskItem] = []
    var onToggleTask: ((String) -> Void)? = nil

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

    func toggleLocalTask(_ id: String) {
        if let index = tasks.firstIndex(where: { $0.id == id }) {
            let item = tasks[index]
            tasks[index] = TaskItem(
                id: item.id,
                text: item.text,
                completed: !item.completed,
                type: item.type,
                timeOfDay: item.timeOfDay,
                time: item.time,
                endTime: item.endTime,
                priority: item.priority,
                createdAt: item.createdAt
            )
        }
        onToggleTask?(id)
    }

    func updateFromJSON(_ jsonString: String) {
        guard let data = jsonString.data(using: .utf8) else { return }
        do {
            let decoded = try JSONDecoder().decode([TaskItem].self, from: data)
            tasks = decoded
            print("[RapidLog] Successfully updated \(decoded.count) tasks in menu bar")
        } catch {
            print("[RapidLog] Failed to decode tasks: \(error)")
        }
    }
}
