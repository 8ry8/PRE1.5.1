import SwiftUI
import UniformTypeIdentifiers

struct ContentView: View {
    @State private var store = WorkspaceStore()
    @State private var selectedTab = 0
    @State private var rawGoal = ""
    @State private var modelClass: ModelClass = .standard
    @State private var outputTier: OutputTier = .tier3
    @State private var contextBlocks: [ContextBlock] = []
    @State private var selectedVariantID: UUID?
    @State private var isImporting = false
    @State private var notice = "Local-first workspace ready. No provider credentials are connected."
    @State private var evaluation: EvaluationResult?

    private var activeVariant: PromptVariant? { store.project.variants.first { $0.id == selectedVariantID } }

    var body: some View {
        TabView(selection: $selectedTab) {
            workbench.tabItem { Label("Workbench", systemImage: "square.and.pencil") }.tag(0)
            review.tabItem { Label("Review", systemImage: "checkmark.seal") }.tag(1)
            linter.tabItem { Label("Linter", systemImage: "slider.horizontal.3") }.tag(2)
            history.tabItem { Label("History", systemImage: "clock.arrow.circlepath") }.tag(3)
            evaluationView.tabItem { Label("Eval", systemImage: "chart.bar.xaxis") }.tag(4)
            evidence.tabItem { Label("Evidence", systemImage: "books.vertical") }.tag(5)
        }
        .tint(Color(red: 0.49, green: 0.88, blue: 0.82))
        .safeAreaInset(edge: .top) {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text("PROMPT REFINING ENGINE").font(.caption2.monospaced()).foregroundStyle(.teal)
                    Text("v1.5.1").font(.caption2.monospaced()).foregroundStyle(.secondary)
                    Spacer()
                    Text("LOCAL-FIRST").font(.caption2.monospaced()).foregroundStyle(.secondary)
                }
                Text(notice).font(.caption2).foregroundStyle(.secondary)
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            .background(.ultraThinMaterial)
        }
        .fileImporter(isPresented: $isImporting, allowedContentTypes: [.plainText, .json, .commaSeparatedText, .sourceCode], allowsMultipleSelection: false) { result in
            importFile(result)
        }
        .preferredColorScheme(.dark)
    }

    private var workbench: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    heading("01 / WORKBENCH", "Make every refinement reviewable", "This offline engine applies the approved rule registry. It does not call an external AI provider.")
                    GroupBox {
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Raw goal or draft prompt").font(.caption).foregroundStyle(.secondary)
                            TextEditor(text: $rawGoal).frame(minHeight: 150).padding(8).background(Color.black.opacity(0.25)).clipShape(RoundedRectangle(cornerRadius: 10))
                            Picker("Behavioral class", selection: $modelClass) { ForEach(ModelClass.allCases) { Text($0.label).tag($0) } }.pickerStyle(.segmented)
                            Picker("Output reliability tier", selection: $outputTier) { ForEach(OutputTier.allCases) { Text($0.label).tag($0) } }.pickerStyle(.menu)
                            HStack {
                                Button("Attach text / JSON") { isImporting = true }.buttonStyle(.bordered)
                                Text("Files stay local and untrusted.").font(.caption2).foregroundStyle(.secondary)
                            }
                            ForEach(contextBlocks) { block in
                                HStack {
                                    Text("\(block.name) · \(block.status)").font(.caption2).foregroundStyle(.secondary)
                                    Spacer()
                                    Button("Remove") { contextBlocks.removeAll { $0.id == block.id } }.font(.caption2)
                                }
                            }
                            Button(activeVariant == nil ? "Refine with local policy engine" : "Create new refined branch") { refine() }.buttonStyle(.borderedProminent).frame(maxWidth: .infinity)
                            Text("Provider adapters and API credentials are intentionally absent from this client.").font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    if let variant = activeVariant {
                        GroupBox {
                            VStack(alignment: .leading, spacing: 10) {
                                HStack { Text("REFINED PRODUCTION PROMPT").font(.caption2.monospaced()).foregroundStyle(.teal); Spacer(); ShareLink(item: variant.refinedPrompt) }
                                Text(variant.refinedPrompt).font(.system(.caption, design: .monospaced)).textSelection(.enabled).padding(12).frame(maxWidth: .infinity, alignment: .leading).background(Color.black.opacity(0.3)).clipShape(RoundedRectangle(cornerRadius: 10))
                            }
                        }
                    } else {
                        emptyCard("No refinement yet", "Enter a goal and create a local versioned snapshot.")
                    }
                }
                .padding()
            }
            .navigationTitle("Workbench")
        }
    }

    private var review: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    heading("02 / REVIEW", "Changes and citations", "Every transformation should point back to a registry rule.")
                    if let variant = activeVariant {
                        Text("\(variant.changes.count) changes · \(variant.citations.count) citations").foregroundStyle(.teal).font(.caption)
                        ForEach(variant.changes) { change in
                            GroupBox {
                                VStack(alignment: .leading, spacing: 7) {
                                    Text("\(change.label.uppercased()) · \(change.ruleID)").font(.caption2.monospaced()).foregroundStyle(.teal)
                                    Text(change.explanation).font(.caption).foregroundStyle(.secondary)
                                    Text("Before: \(change.before)").font(.caption2).foregroundStyle(.secondary)
                                    Text("After: \(change.after)").font(.caption2).foregroundStyle(.green)
                                }
                            }
                        }
                    } else {
                        emptyCard("Refine a prompt first", "The change ledger will appear here.")
                    }
                }.padding()
            }.navigationTitle("Review & citations")
        }
    }

    private var linter: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    heading("03 / LINTER", "Pre-flight checks", "Diagnostics are deterministic and illustrative; provider pricing must be verified before production.")
                    if let variant = activeVariant {
                        let tokens = max(1, variant.refinedPrompt.count / 4)
                        GroupBox {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("\(tokens.formatted()) estimated input tokens").font(.headline)
                                Text("Class: \(variant.modelClass.label) · Tier: \(variant.outputTier.label)").font(.caption).foregroundStyle(.secondary)
                                Divider()
                                Text("Provider adapter: not connected").foregroundStyle(.orange).font(.caption)
                                Text("Reserve room for output and model-specific reasoning before dispatch.").foregroundStyle(.secondary).font(.caption)
                            }
                        }
                        ForEach(variant.diagnostics) { diagnostic in diagnosticCard(diagnostic) }
                    } else {
                        emptyCard("Refine a prompt first", "The linter needs a concrete variant.")
                    }
                }.padding()
            }.navigationTitle("Linter & budget")
        }
    }

    private var history: some View {
        NavigationStack {
            List {
                Section {
                    TextField("Project name", text: Binding(get: { store.project.name }, set: { store.rename($0) }))
                } header: { Text("PROJECT") }
                Section {
                    if store.project.variants.isEmpty { Text("No saved variants yet.").foregroundStyle(.secondary) }
                    ForEach(store.project.variants.reversed()) { variant in
                        Button {
                            selectedVariantID = variant.id
                            rawGoal = variant.rawGoal
                            modelClass = variant.modelClass
                            outputTier = variant.outputTier
                            contextBlocks = variant.contextBlocks
                            notice = "Loaded a saved variant. No data was changed."
                            selectedTab = 0
                        } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(variant.rawGoal.isEmpty ? "Untitled goal" : variant.rawGoal).lineLimit(2)
                                Text("\(variant.modelClass.label) · \(variant.citations.count) citations · \(variant.createdAt.formatted(date: .abbreviated, time: .shortened))").font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                    }
                } header: { Text("LOCAL SNAPSHOTS") }
            }
            .navigationTitle("History & branches")
        }
    }

    private var evaluationView: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    heading("05 / EVAL + SAFETY", "Measure before you trust", "This is a local simulation of the five supplied regression cases, not an LLM judge.")
                    if let variant = activeVariant {
                        Button("Run local regression suite") {
                            evaluation = PromptEngine.evaluate(variant)
                            notice = "Local regression suite complete. No provider call occurred."
                        }.buttonStyle(.borderedProminent).frame(maxWidth: .infinity)
                        if let evaluation {
                            Text("\(evaluation.passed)/\(evaluation.total) passed · \(evaluation.score)%").font(.title2.bold()).foregroundStyle(.teal)
                            ForEach(evaluation.cases) { item in
                                HStack(alignment: .top) {
                                    Text(item.pass ? "✓" : "×").foregroundStyle(item.pass ? .green : .red).font(.title3)
                                    VStack(alignment: .leading) { Text(item.title).font(.headline); Text(item.reason).font(.caption).foregroundStyle(.secondary) }
                                }.padding(10).background(Color.white.opacity(0.05)).clipShape(RoundedRectangle(cornerRadius: 10))
                            }
                            Text(evaluation.notes.joined(separator: "\n")).font(.caption2).foregroundStyle(.orange)
                        } else {
                            emptyCard("No evaluation yet", "Run the deterministic suite to compare this version against the framework fixtures.")
                        }
                    } else {
                        emptyCard("Refine a prompt first", "The regression suite needs a variant.")
                    }
                }.padding()
            }.navigationTitle("Eval & safety")
        }
    }

    private var evidence: some View {
        NavigationStack {
            List {
                Section { Text("The registry is inspectable data. Source dates and confidence prevent unverified claims from looking permanent.").font(.caption).foregroundStyle(.secondary) } header: { Text("06 / EVIDENCE") }
                Section("Core rule IDs") {
                    ForEach(FrameworkCatalog.rules) { rule in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(rule.id).font(.caption2.monospaced()).foregroundStyle(.teal)
                            Text(rule.title).font(.headline)
                            Text(rule.claim).font(.caption).foregroundStyle(.secondary)
                            Text(rule.locator).font(.caption2).foregroundStyle(.secondary)
                        }.padding(.vertical, 5)
                    }
                }
            }.navigationTitle("Evidence library")
        }
    }

    private func refine() {
        let result = PromptEngine.refine(goal: rawGoal, context: contextBlocks, modelClass: modelClass, outputTier: outputTier)
        let variant = PromptVariant(parentID: selectedVariantID, rawGoal: rawGoal, refinedPrompt: result.prompt, modelClass: result.modelClass, outputTier: result.outputTier, contextBlocks: contextBlocks, citations: result.citations, changes: result.changes, diagnostics: result.diagnostics)
        store.add(variant)
        selectedVariantID = variant.id
        evaluation = nil
        notice = "Created a \(variant.parentID == nil ? "root" : "branch") variant. No provider call occurred."
    }

    private func importFile(_ result: Result<[URL], Error>) {
        guard case .success(let urls) = result, let url = urls.first else { return }
        do {
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            let text = try String(contentsOf: url, encoding: .utf8)
            contextBlocks.append(ContextBlock(name: url.lastPathComponent, text: text, sha256: "apple-local-hash-pending"))
            notice = "\(url.lastPathComponent) was read locally and marked untrusted."
        } catch { notice = "The selected file could not be read as UTF-8 text." }
    }

    private func heading(_ kicker: String, _ title: String, _ description: String) -> some View {
        VStack(alignment: .leading, spacing: 5) { Text(kicker).font(.caption2.monospaced()).foregroundStyle(.teal); Text(title).font(.largeTitle.bold()); Text(description).font(.caption).foregroundStyle(.secondary) }
    }

    private func emptyCard(_ title: String, _ description: String) -> some View {
        GroupBox { VStack(alignment: .leading, spacing: 5) { Text(title).font(.headline); Text(description).font(.caption).foregroundStyle(.secondary) } }
    }

    private func diagnosticCard(_ diagnostic: Diagnostic) -> some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 5) {
                Text("\(diagnostic.severity.rawValue.uppercased()) · \(diagnostic.title)").font(.caption.bold()).foregroundStyle(diagnostic.severity == .block ? .red : .teal)
                Text(diagnostic.message).font(.caption).foregroundStyle(.secondary)
                Text("Fix: \(diagnostic.fix)").font(.caption2).foregroundStyle(.orange)
            }
        }
    }
}
