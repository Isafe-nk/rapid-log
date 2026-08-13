import SwiftUI

struct MenuBarPopover: View {
    @ObservedObject var viewModel: MenuBarViewModel

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
                                    .transition(.opacity.combined(with: .offset(y: -6)))
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
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.system(size: 9, weight: .heavy, design: .monospaced))
                .foregroundStyle(.tertiary)
                .tracking(2)
                .padding(.bottom, 2)

            ForEach(tasks) { task in
                TaskRowView(task: task, viewModel: viewModel)
                    .transition(.asymmetric(
                        insertion: .opacity.combined(with: .offset(y: -4)),
                        removal: .opacity.combined(with: .scale(scale: 0.96, anchor: .leading))
                    ))
            }
        }
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
                    CompletedTaskRowView(task: task, viewModel: viewModel)
                        .transition(.asymmetric(
                            insertion: .opacity.combined(with: .offset(y: -4)),
                            removal: .opacity.combined(with: .scale(scale: 0.96, anchor: .leading))
                        ))
                }
            }
        }
    }

    private func badge(count: Int, label: String, color: Color) -> some View {
        HStack(spacing: 3) {
            Text("\(count)")
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .foregroundStyle(color)
                // The tally rolls rather than snapping, so it reads as the same
                // number changing instead of a different glyph appearing.
                .contentTransition(.numericText())
                .animation(.snappy(duration: 0.3), value: count)
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

// MARK: - Active Task Row with Hover Completion
struct TaskRowView: View {
    let task: TaskItem
    @ObservedObject var viewModel: MenuBarViewModel
    @State private var isHovered = false

    /// Committed by a tap, as opposed to merely previewed by a hover.
    private var isDone: Bool { viewModel.displayCompleted(task) }
    private var showsCheck: Bool { isDone || isHovered }

    var body: some View {
        Button {
            viewModel.toggleLocalTask(task.id)
        } label: {
            HStack(alignment: .top, spacing: 8) {
                ZStack {
                    if showsCheck {
                        Text("✓")
                            .font(.system(size: 11, weight: .bold, design: .monospaced))
                            .foregroundStyle(.green)
                            .transition(.scale(scale: 0.3).combined(with: .opacity))
                    } else {
                        Text(bulletFor(task))
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(task.priority ? .orange : .secondary)
                            .transition(.scale(scale: 0.6).combined(with: .opacity))
                    }
                }
                .frame(width: 14)
                // Low damping gives the check a small overshoot as it lands.
                .animation(.spring(response: 0.26, dampingFraction: 0.55), value: showsCheck)

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 4) {
                        if task.priority {
                            Text("★")
                                .font(.system(size: 9))
                                .foregroundStyle(.orange)
                                .opacity(isDone ? 0.45 : 1)
                        }
                        Text(task.text)
                            .font(.system(size: 12, weight: .regular, design: .monospaced))
                            .foregroundStyle(isDone ? .secondary : .primary)
                            .strikethrough(showsCheck, color: .secondary)
                            .lineLimit(2)
                            .animation(.easeOut(duration: 0.22), value: showsCheck)
                            .animation(.easeOut(duration: 0.22), value: isDone)
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
            .padding(.vertical, 3)
            .padding(.horizontal, 6)
            .background(rowFill)
            .cornerRadius(6)
            // Without this the Spacer and clear background are not hit-tested,
            // so only the bullet and title responded to hover and clicks while
            // the highlight spanned the whole row.
            .contentShape(Rectangle())
        }
        .buttonStyle(RowButtonStyle())
        .onHover { hovering in
            withAnimation(.easeOut(duration: 0.16)) {
                isHovered = hovering
            }
        }
    }

    /// A brief green wash confirms the completion before the row leaves.
    private var rowFill: Color {
        if isDone { return Color.green.opacity(0.11) }
        if isHovered { return Color.primary.opacity(0.06) }
        return .clear
    }

    private func bulletFor(_ task: TaskItem) -> String {
        switch task.type {
        case "event": return "○"
        case "note": return "—"
        default: return "●"
        }
    }
}

// MARK: - Completed Task Row with Hover Restore
struct CompletedTaskRowView: View {
    let task: TaskItem
    @ObservedObject var viewModel: MenuBarViewModel
    @State private var isHovered = false

    var body: some View {
        Button {
            viewModel.toggleLocalTask(task.id)
        } label: {
            HStack(spacing: 8) {
                ZStack {
                    if showsRestore {
                        Text("↺")
                            .font(.system(size: 10, weight: .bold, design: .monospaced))
                            .foregroundStyle(.orange)
                            .transition(.scale(scale: 0.4).combined(with: .opacity))
                    } else {
                        Text("✓")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(.green)
                            .transition(.scale(scale: 0.4).combined(with: .opacity))
                    }
                }
                .frame(width: 14)
                .animation(.spring(response: 0.26, dampingFraction: 0.55), value: showsRestore)

                Text(task.text)
                    .font(.system(size: 11, design: .monospaced))
                    .strikethrough(!showsRestore)
                    .foregroundStyle(showsRestore ? .primary : .tertiary)
                    .lineLimit(1)
                    .animation(.easeOut(duration: 0.22), value: showsRestore)

                Spacer()
            }
            .padding(.vertical, 2)
            .padding(.horizontal, 6)
            .background(rowFill)
            .cornerRadius(6)
            .contentShape(Rectangle())
        }
        .buttonStyle(RowButtonStyle())
        .onHover { hovering in
            withAnimation(.easeOut(duration: 0.16)) {
                isHovered = hovering
            }
        }
    }

    /// Committed by a tap, as opposed to merely previewed by a hover.
    private var isRestoring: Bool { !viewModel.displayCompleted(task) }
    private var showsRestore: Bool { isRestoring || isHovered }

    private var rowFill: Color {
        if isRestoring { return Color.orange.opacity(0.10) }
        if isHovered { return Color.primary.opacity(0.06) }
        return .clear
    }
}

/// Subtle press feedback so a click registers physically rather than only
/// changing state. Replaces .plain, which gave no acknowledgement at all.
struct RowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}
