import SwiftUI
import AppKit

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

    /// Only a task can be ticked. The log window gives a checkbox to a task and
    /// nothing else — an event gets a plain dot and a note gets no mark at all —
    /// so a popover that let any row be completed was offering something the app
    /// it mirrors does not have, and writing `completed` onto entries that have
    /// no way to show it or undo it in the window.
    private var isCompletable: Bool { task.type == "task" }

    /// Committed by a tap, as opposed to merely previewed by a hover.
    private var isDone: Bool { viewModel.displayCompleted(task) }
    private var showsCheck: Bool { isCompletable && (isDone || isHovered) }

    var body: some View {
        if isCompletable {
            Button {
                viewModel.toggleLocalTask(task.id)
            } label: {
                row
            }
            .buttonStyle(RowButtonStyle())
            .onHover { hovering in
                withAnimation(.easeOut(duration: 0.16)) {
                    isHovered = hovering
                }
            }
        } else {
            // No button, no hover, no press feedback: an event or a note is a
            // line in the log, not a control, and the popover should not invite
            // a click that the window has no equivalent for.
            row
        }
    }

    private var row: some View {
        // .firstTextBaseline, not .top. Topping-aligned marks look level only
        // when they are all the same height, and these are not: the task square
        // is 9pt, the event dot 5pt, the note bar 1.5pt and the check about 13.
        // Pinning each one's top to the top of the text put every mark's centre
        // a different distance above the words — worst for the note bar, which
        // floated near the cap line, and least bad for the square, which is why
        // only the square ever looked right.
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            ZStack {
                if showsCheck {
                    Image(systemName: "checkmark")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(.green)
                        .transition(.scale(scale: 0.3).combined(with: .opacity))
                } else {
                    // Untinted. The log never colours a mark for priority —
                    // the star carries that, and tinting the bullet too said
                    // it twice in a place the log says it once.
                    BulletMark(type: task.type)
                        .foregroundStyle(.secondary)
                        .transition(.scale(scale: 0.6).combined(with: .opacity))
                }
            }
            .frame(width: 14)
            // Every mark now hangs from the same line: its own centre sits at
            // the optical middle of the lowercase letters, whatever its height.
            .alignmentGuide(.firstTextBaseline) { d in d.height / 2 + RowFont.opticalCentre }
            // Low damping gives the check a small overshoot as it lands.
            .animation(.spring(response: 0.26, dampingFraction: 0.55), value: showsCheck)

            VStack(alignment: .leading, spacing: 2) {
                // Also baseline-aligned, and for a second reason: it is what
                // the outer HStack reads to find the row's baseline. Left on
                // .center this group reported a baseline that moved whenever a
                // priority star appeared, and the mark beside it moved too.
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    if task.priority {
                        Image(systemName: "star.fill")
                            .font(.system(size: 8))
                            .foregroundStyle(RowFont.priority)
                            .opacity(isDone ? 0.45 : 1)
                    }
                    Text(task.text)
                        .font(.system(size: RowFont.size, weight: .regular, design: .monospaced))
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

    /// A brief green wash confirms the completion before the row leaves.
    private var rowFill: Color {
        guard isCompletable else { return .clear }
        if isDone { return Color.green.opacity(0.11) }
        if isHovered { return Color.primary.opacity(0.06) }
        return .clear
    }

    // bulletFor() used to return "○", "—" and "●" as text. Those are the same
    // typed glyphs the web list and the menu bar item both had to give up: a
    // character's diameter, stroke weight and baseline all come from whichever
    // font resolves it, so it never matched the marks beside it. The web list
    // now draws an 8px filled dot for an event, and this drew an outlined
    // circle — the two surfaces disagreed about what an event looks like.
    //
    // Drawn here too, from the same proportions the web app's GLYPH_SHAPE
    // declares, scaled to this row's 14pt column.
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
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                ZStack {
                    if showsRestore {
                        Image(systemName: "arrow.uturn.backward")
                            .font(.system(size: 9, weight: .bold))
                            .foregroundStyle(.orange)
                            .transition(.scale(scale: 0.4).combined(with: .opacity))
                    } else if task.type == "task" {
                        Image(systemName: "checkmark")
                            .font(.system(size: 9))
                            .foregroundStyle(.green)
                            .transition(.scale(scale: 0.4).combined(with: .opacity))
                    } else {
                        // A green tick on an event or a note claimed it had
                        // been ticked, and nothing in this app can tick one.
                        // It keeps its own mark here, faded because the row is
                        // done; hovering still offers the way back.
                        BulletMark(type: task.type)
                            .foregroundStyle(.tertiary)
                            .transition(.scale(scale: 0.6).combined(with: .opacity))
                    }
                }
                .frame(width: 14)
                .alignmentGuide(.firstTextBaseline) { d in d.height / 2 + RowFont.opticalCentre }
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

/// The row title's own metrics, so a mark can be placed against the letters
/// instead of against the line box.
///
/// The two are not the same place. A line box carries descender room that most
/// of a lowercase word never uses, so its middle sits below the middle of the
/// letters — centring a bullet there leaves it looking low. Half the x-height
/// above the baseline is where the eye reads the middle of a word to be.
enum RowFont {
    static let size: CGFloat = 12

    /// How far above the baseline a mark's centre belongs.
    static let opticalCentre: CGFloat =
        NSFont.monospacedSystemFont(ofSize: size, weight: .regular).xHeight / 2

    /// amber-500, the log's priority colour. `.orange` is a system hue tuned
    /// for macOS, not this app, and the two are visibly different side by side.
    static let priority = Color(red: 245 / 255, green: 158 / 255, blue: 11 / 255)
}

/// The entry marks, drawn rather than typed.
///
/// Proportions follow the web app's GLYPH_SHAPE so the popover and the log
/// agree on what each kind of entry looks like:
///
///   task   a square outline, the checkbox shape at this size
///   event  a small filled dot — filled so it does not read as a control
///          waiting to be ticked, and small so it does not read as a task
///          already completed
///   note   a short bar, the rail the log draws beside a note
struct BulletMark: View {
    let type: String

    var body: some View {
        switch type {
        case "event":
            // 40% of the task mark, as 8px is of the log's 20px checkbox. It
            // was 5pt, which is 56% — enough that the dot read as a small
            // checkbox rather than a different kind of thing.
            Circle()
                .frame(width: 4, height: 4)
        case "note":
            // Vertical, because a note's mark is the rail running down the
            // side of its text. This was drawn 7x1.5 — lying on its side. The
            // log has never drawn a horizontal mark for anything.
            RoundedRectangle(cornerRadius: 0.5)
                .frame(width: 1, height: 10)
        default:
            RoundedRectangle(cornerRadius: 2)
                .stroke(lineWidth: 1.5)
                .frame(width: 9, height: 9)
        }
    }
}
