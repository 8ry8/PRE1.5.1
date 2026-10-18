import Foundation

// These Codable models mirror shared/prompt-project.schema.json and the Android
// data classes. Keeping the contract portable makes branch history exportable.
enum ModelClass: String, Codable, CaseIterable, Identifiable {
    case standard, reasoning, agentic
    var id: String { rawValue }
    var label: String { rawValue.capitalized }
}

enum OutputTier: String, Codable, CaseIterable, Identifiable {
    case tier1, tier2, tier3
    var id: String { rawValue }
    var label: String {
        switch self {
        case .tier1: return "Tier 1 · strict schema"
        case .tier2: return "Tier 2 · JSON object"
        case .tier3: return "Tier 3 · fenced parser"
        }
    }
}

enum Severity: String, Codable, CaseIterable {
    case block, warning, info
}

struct Citation: Codable, Hashable, Identifiable {
    var id: String { ruleID }
    let ruleID: String
    let locator: String
    let confidence: String
}

struct ChangeRecord: Codable, Hashable, Identifiable {
    let id = UUID()
    let label: String
    let before: String
    let after: String
    let ruleID: String
    let explanation: String
}

struct Diagnostic: Codable, Hashable, Identifiable {
    let id = UUID()
    let severity: Severity
    let title: String
    let message: String
    let fix: String
    let ruleID: String
}

struct ContextBlock: Codable, Hashable, Identifiable {
    var id = UUID()
    let name: String
    var classification: String = "untrusted-attachment"
    let text: String
    let sha256: String
    var status: String = "ready"
}

struct EvaluationCase: Codable, Hashable, Identifiable {
    let id = UUID()
    let title: String
    let pass: Bool
    let reason: String
}

struct EvaluationResult: Codable, Hashable {
    let passed: Int
    let total: Int
    let score: Int
    let notes: [String]
    let cases: [EvaluationCase]
}

struct PromptVariant: Codable, Hashable, Identifiable {
    let id: UUID
    let parentID: UUID?
    let rawGoal: String
    let refinedPrompt: String
    let modelClass: ModelClass
    let targetModel: String
    let outputTier: OutputTier
    let createdAt: Date
    let contextBlocks: [ContextBlock]
    let citations: [Citation]
    let changes: [ChangeRecord]
    let diagnostics: [Diagnostic]
    var evaluation: EvaluationResult?

    init(
        id: UUID = UUID(),
        parentID: UUID? = nil,
        rawGoal: String,
        refinedPrompt: String,
        modelClass: ModelClass,
        targetModel: String = "apple-local-policy",
        outputTier: OutputTier,
        createdAt: Date = Date(),
        contextBlocks: [ContextBlock] = [],
        citations: [Citation] = [],
        changes: [ChangeRecord] = [],
        diagnostics: [Diagnostic] = [],
        evaluation: EvaluationResult? = nil
    ) {
        self.id = id
        self.parentID = parentID
        self.rawGoal = rawGoal
        self.refinedPrompt = refinedPrompt
        self.modelClass = modelClass
        self.targetModel = targetModel
        self.outputTier = outputTier
        self.createdAt = createdAt
        self.contextBlocks = contextBlocks
        self.citations = citations
        self.changes = changes
        self.diagnostics = diagnostics
        self.evaluation = evaluation
    }
}

struct PromptProject: Codable, Hashable {
    var id: UUID = UUID()
    var name: String = "Untitled prompt project"
    var frameworkVersion: String = "framework-2026.10.18"
    var variants: [PromptVariant] = []
    var updatedAt: Date = Date()
}
