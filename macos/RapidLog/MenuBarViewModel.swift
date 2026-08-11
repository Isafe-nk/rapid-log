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

/// Minutes since midnight for a stored display time like "9:00 AM", or nil when
/// the entry has no time set (or an unrecognised one). Mirrors minutesOfDay in
/// the web app so the popover and the window order a section identically.
fileprivate func minutesOfDay(_ time: String?) -> Int? {
    guard let raw = time?.trimmingCharacters(in: .whitespaces), !raw.isEmpty else { return nil }
    let parts = raw.split(separator: " ")
    guard parts.count == 2 else { return nil }

    let clock = parts[0].split(separator: ":")
    guard clock.count == 2,
          let hour = Int(clock[0]), let minute = Int(clock[1]),
          (0...23).contains(hour), (0...59).contains(minute) else { return nil }

    let suffix = parts[1].uppercased()
    guard suffix == "AM" || suffix == "PM" else { return nil }

    return (hour % 12 + (suffix == "PM" ? 12 : 0)) * 60 + minute
}

/// A section reads as a timeline: timed entries in clock order, then untimed
/// ones in the order they were added. The priority star is purely visual and
/// does not reorder anything.
fileprivate func byTimeThenCreated(_ a: TaskItem, _ b: TaskItem) -> Bool {
    switch (minutesOfDay(a.time), minutesOfDay(b.time)) {
    case let (x?, y?) where x != y: return x < y
    case (_?, nil): return true
    case (nil, _?): return false
    default: return a.createdAt < b.createdAt
    }
}

class MenuBarViewModel: ObservableObject {
    @Published var tasks: [TaskItem] = []
    var onToggleTask: ((String) -> Void)? = nil

    var activeTasks: [TaskItem] {
        tasks.filter { !$0.completed }
    }

    var completedTasks: [TaskItem] {
        tasks.filter { $0.completed }.sorted(by: byTimeThenCreated)
    }

    var activeCount: Int { activeTasks.count }
    var completedCount: Int { completedTasks.count }
    var totalCount: Int { tasks.count }

    func tasksForSection(_ section: String) -> [TaskItem] {
        activeTasks
            .filter { $0.timeOfDay == section }
            .sorted(by: byTimeThenCreated)
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
