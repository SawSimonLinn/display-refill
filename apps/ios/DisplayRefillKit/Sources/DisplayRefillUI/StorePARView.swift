import SwiftUI
import DisplayRefillCore

/// Profile → store → PAR (store managers and admins). Changes apply from the next stock check;
/// checks already started keep the PAR they began with.
struct StorePARView: View {
    let store: Me.Store
    @State private var model: StorePARModel
    @FocusState private var focused: String?

    init(store: Me.Store, api: any StorePARAPI) {
        self.store = store
        _model = State(initialValue: StorePARModel(api: api, storeID: store.id.uuidString.lowercased()))
    }

    var body: some View {
        List {
            Section {
                Text("How many of each product the display case should hold at this store. Changes apply from the next stock check.")
                    .font(.subheadline).foregroundStyle(.secondary)
                if let error = model.error {
                    Label(error, systemImage: "exclamationmark.triangle").font(.subheadline).foregroundStyle(Theme.destructive)
                }
            }
            if let config = model.config {
                if !config.can_manage {
                    Text("Only the store's manager can change PAR.").font(.subheadline).foregroundStyle(.secondary)
                } else if config.groups.isEmpty {
                    ContentUnavailableView("No products yet", systemImage: "square.grid.3x3",
                                           description: Text("Choose display cases for this store first."))
                } else {
                    ForEach(config.groups, id: \.code) { group in
                        Section(group.name) {
                            ForEach(group.items) { item in row(item) }
                        }
                    }
                }
            } else if model.loading {
                ProgressView("Loading PAR")
            }
        }
        .pageBackground()
        .navigationTitle("PAR")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        #if os(iOS)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { focused = nil }
            }
        }
        #endif
        .refreshable { await model.load() }
        .task { await model.load() }
    }

    private func row(_ item: StorePARItem) -> some View {
        let changed = model.changedPAR(item) != nil
        let saving = model.saving == item.id
        return HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(item.product_name).font(.body)
                if let note = note(item) {
                    Text(note).font(.footnote).foregroundStyle(item.par_overridden == true ? Theme.verify : .secondary)
                }
                if item.canReset {
                    Button("Reset to default") { focused = nil; Task { await model.reset(item) } }
                        .font(.footnote.weight(.semibold)).foregroundStyle(Theme.action)
                        .buttonStyle(.borderless).disabled(model.saving != nil)
                }
            }
            Spacer(minLength: 8)
            if saving {
                ProgressView()
            } else if changed {
                Button("Save") { focused = nil; Task { await model.save(item) } }
                    .buttonStyle(.borderless).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.action)
                    .disabled(model.saving != nil)
            } else if model.savedItem == item.id {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.confirmed).accessibilityLabel("Saved")
            }
            TextField("PAR", text: Binding(get: { model.inputs[item.id] ?? "" }, set: { model.inputs[item.id] = String($0.filter(\.isNumber).prefix(4)) }))
                .font(.title3.weight(.semibold)).monospacedDigit().multilineTextAlignment(.center)
                .frame(width: 72).filledField()
                .foregroundStyle(model.isInvalid(item) ? Theme.destructive : .primary)
                #if os(iOS)
                .keyboardType(.numberPad)
                #endif
                .focused($focused, equals: item.id)
                .disabled(model.saving != nil)
                .onSubmit { Task { await model.save(item) } }
                .accessibilityLabel("PAR for \(item.product_name)")
        }
        .padding(.vertical, 2)
    }

    private func note(_ item: StorePARItem) -> String? {
        guard item.from_display_type == true, let base = item.default_par else { return nil }
        return item.par_overridden == true ? "Store PAR · default \(base)" : "Display case default"
    }
}
