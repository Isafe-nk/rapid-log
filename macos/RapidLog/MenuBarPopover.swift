import SwiftUI

struct MenuBarPopover: View {
    let viewModel: MenuBarViewModel

    @State private var showCompleted = false

    private let sections = [
        ("morning", "Morning"),
        ("noon", "Noon"),
        ("night", "Night")
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            header
            Divider()

            if viewModel.totalCount == 0 {
                emptyState
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        // Active tasks by section
                        ForEach(sections, id: \.0) { sectionId, sectionLabel in
                            let sectionTasks = viewModel.tasksForSection(sectionId)
                            if !sectionTasks.isEmpty {
                                sectionView(label: sectionLabel, tasks: sectionTasks)
                            }
                        }

                        // Completed
                        if !viewModel.completedTasks.isEmpty {
                            completedSection
                        }
                    }
                    .padding(14)
                }
                .frame(maxHeight: 360)
            }

            Divider()
            footer
        }
        .frame(width: 280)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    // MARK: - Header
    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Today")
                    .font(.system(size: 16, weight: .bold, design: .serif))
                    .italic()
                Text(dateString())
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
            Spacer()
            HStack(spacing: 6) {
                badge(count: viewModel.activeCount, label: "to do", color: .primary)
                badge(count: viewModel.completedCount, label: "done", color: .green)
            }
        }
        .padding(14)
    }

    // MARK: - Empty State
    private var emptyState: some View {
        VStack(spacing: 8) {
            Text("No entries yet")
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .foregroundStyle(.secondary)
            Text("Open Rapid Log to add tasks")
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 32)
    }

    // MARK: - Section
    private func sectionView(label: String, tasks: [TaskItem]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .heavy, design: .monospaced))
                .foregroundStyle(.tertiary)
                .tracking(2)

            ForEach(tasks) { task in
                taskRow(task)
            }
        }
    }

    // MARK: - Task Row
    private func taskRow(_ task: TaskItem) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text(bulletFor(task))
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(task.priority ? .orange : .secondary)
                .frame(width: 12)

            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    if task.priority {
                        Text("★")
                            .font(.system(size: 9))
                            .foregroundStyle(.orange)
                    }
                    Text(task.text)
                        .font(.system(size: 12, weight: .regular, design: .monospaced))
                        .lineLimit(2)
                }

                if let time = task.time {
                    HStack(spacing: 0) {
                        Text(time)
                            .font(.system(size: 9, weight: .medium, design: .monospaced))
                            .foregroundStyle(.secondary)
                        if let endTime = task.endTime {
                            Text(" – \(endTime)")
                                .font(.system(size: 9, weight: .medium, design: .monospaced))
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            Spacer()
        }
        .padding(.vertical, 2)
    }

    // MARK: - Completed
    private var completedSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    showCompleted.toggle()
                }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: showCompleted ? "chevron.down" : "chevron.right")
                        .font(.system(size: 8, weight: .bold))
                    Text("DONE (\(viewModel.completedCount))")
                        .font(.system(size: 9, weight: .heavy, design: .monospaced))
                        .tracking(2)
                }
                .foregroundStyle(.tertiary)
            }
            .buttonStyle(.plain)

            if showCompleted {
                ForEach(viewModel.completedTasks) { task in
                    HStack(spacing: 8) {
                        Text("✓")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(.green)
                            .frame(width: 12)
                        Text(task.text)
                            .font(.system(size: 11, design: .monospaced))
                            .strikethrough()
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                    }
                    .padding(.vertical, 1)
                }
            }
        }
    }

    // MARK: - Footer
    private var footer: some View {
        Button {
            NSApp.activate(ignoringOtherApps: true)
            // Bring the main window to front
            for window in NSApp.windows where window.title == "Rapid Log" || window.canBecomeMain {
                window.makeKeyAndOrderFront(nil)
                break
            }
        } label: {
            HStack {
                Spacer()
                Text("Open Rapid Log")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .tracking(1)
                Spacer()
            }
            .padding(.vertical, 8)
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 14)
        .padding(.vertical, 4)
    }

    // MARK: - Helpers
    private func bulletFor(_ task: TaskItem) -> String {
        switch task.type {
        case "event": return "○"
        case "note": return "—"
        default: return "●"
        }
    }

    private func badge(count: Int, label: String, color: Color) -> some View {
        HStack(spacing: 3) {
            Text("\(count)")
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .foregroundStyle(color)
            Text(label)
                .font(.system(size: 9, weight: .medium, design: .monospaced))
                .foregroundStyle(.tertiary)
        }
    }

    private func dateString() -> String {
        let fmt = DateFormatter()
        fmt.dateFormat = "EEEE, d MMM"
        return fmt.string(from: Date())
    }
}
