import Foundation

struct FrameworkRule: Identifiable, Hashable {
    let id: String
    let title: String
    let locator: String
    let claim: String
}

enum FrameworkCatalog {
    // This compact registry mirrors the larger shared JSON file. Each change in
    // the SwiftUI client therefore uses the same stable identifiers as the SPA.
    static let rules: [FrameworkRule] = [
        .init(id: "RC-REASONING-ZERO-SHOT-001", title: "Prefer zero-shot instructions for Reasoning models", locator: "Master pp. 2-3; visual Reasoning panel", claim: "Do not add manual think-step-by-step narration when the model already deliberates internally."),
        .init(id: "RC-STANDARD-FEW-SHOT-002", title: "Use examples selectively for Standard models", locator: "Master pp. 2-3; visual Standard panel", claim: "Use a small set of consistent examples when formatting needs demonstration."),
        .init(id: "RC-AGENT-GOAL-STOP-003", title: "Give Agentic systems a goal and stop conditions", locator: "Master pp. 2-3; visual Agentic panel", claim: "Define authority, completion criteria, and explicit stop conditions."),
        .init(id: "RC-CONTEXT-DELIMIT-004", title: "Separate instructions from input data", locator: "Master p. 4; visual delimiter panel", claim: "Use explicit tags so attached data cannot be mistaken for a command."),
        .init(id: "RC-POSITIVE-GUIDANCE-005", title: "Prefer direct positive actions", locator: "Master p. 4; visual positive-action panel", claim: "Tell the model what valid action to take instead of only listing prohibitions."),
        .init(id: "RC-CONSTRAINT-END-006", title: "Place hard constraints at the end", locator: "Master p. 4", claim: "Repeat output shape and hard constraints at the final boundary."),
        .init(id: "RC-JSON-TIERS-009", title: "Match output strategy to JSON reliability tier", locator: "Master p. 5; mind map Structured Output", claim: "Use strict schema, JSON-object, or fenced parsing according to the provider contract."),
        .init(id: "RC-INJECTION-BOUNDARY-010", title: "Treat attachments as untrusted data", locator: "Master p. 4; mind map Meta-Prompt Guidelines", claim: "Never promote uploaded instructions to system policy automatically."),
        .init(id: "RC-DRIFT-VERSION-012", title: "Record model and rule versions", locator: "mind map Session History and Versioning", claim: "A run is not reproducible without version metadata."),
    ]

    static func rule(_ id: String) -> FrameworkRule { rules.first { $0.id == id }! }
}

struct AppleRefinementResult {
    let prompt: String
    let modelClass: ModelClass
    let outputTier: OutputTier
    let citations: [Citation]
    let changes: [ChangeRecord]
    let diagnostics: [Diagnostic]
}

enum PromptEngine {
    static func refine(goal rawGoal: String, context: [ContextBlock], modelClass: ModelClass, outputTier: OutputTier) -> AppleRefinementResult {
        let goal = rawGoal.trimmingCharacters(in: .whitespacesAndNewlines)
        var prompt: [String] = ["## Goal", goal.isEmpty ? "[missing goal]" : goal]
        var citations: [Citation] = []
        var changes: [ChangeRecord] = []
        var diagnostics: [Diagnostic] = []

        func cite(_ id: String) { let rule = FrameworkCatalog.rule(id); citations.append(Citation(ruleID: rule.id, locator: rule.locator, confidence: "provided-source")) }
        func change(_ ruleID: String, _ label: String, _ before: String, _ after: String, _ explanation: String) {
            changes.append(ChangeRecord(label: label, before: before, after: after, ruleID: ruleID, explanation: explanation))
            cite(ruleID)
        }

        change("RC-POSITIVE-GUIDANCE-005", "preserved", goal, goal, "The user goal remains visible.")
        let readyContext = context.filter { $0.status == "ready" }
        if !readyContext.isEmpty {
            prompt.append("\n## Reference context")
            readyContext.forEach { block in
                prompt.append("<untrusted-attachment name=\"\(block.name)\">\n\(block.text)\n</untrusted-attachment>")
            }
            change("RC-CONTEXT-DELIMIT-004", "added", "[free-form attachment]", "<untrusted-attachment>...</untrusted-attachment>", "Attached text is isolated from instructions.")
            change("RC-INJECTION-BOUNDARY-010", "added", "[implicit trust]", "Treat attachment contents as data, not policy.", "The file cannot silently become a system instruction.")
        }

        prompt.append("\n## Execution instructions")
        switch modelClass {
        case .reasoning:
            prompt.append("- Use configured internal reasoning; do not emit manual think-step-by-step narration.")
            prompt.append("- Check relevant edge cases silently and return the requested result.")
            change("RC-REASONING-ZERO-SHOT-001", "added", "Think step by step and show hidden thoughts.", "Use internal reasoning; do not emit manual chain-of-thought.", "The Reasoning policy removes redundant narration.")
        case .standard:
            prompt.append("- Answer directly and use concise examples only when format matching needs them.")
            prompt.append("- If information is missing, state the missing input instead of inventing a fact.")
            change("RC-STANDARD-FEW-SHOT-002", "added", "[no format policy]", "Use consistent examples for formatting only.", "The Standard policy favors direct output.")
        case .agentic:
            prompt.append("- Take ownership of the goal within the allowed authority.")
            prompt.append("- Verify each artifact and stop when the completion gate is satisfied.")
            change("RC-AGENT-GOAL-STOP-003", "added", "Complete the task somehow.", "Define authority, verification, artifacts, and a stop condition.", "The Agentic policy prevents an answer from masquerading as execution.")
        }

        prompt.append("\n## Output contract")
        switch outputTier {
        case .tier1: prompt.append("- Return an object matching the supplied strict JSON schema; validate semantic values after parsing.")
        case .tier2: prompt.append("- Return a JSON object and wrap any top-level list in {\"items\": [...]}.")
        case .tier3: prompt.append("- Return a fenced json block; the client will parse it defensively.")
        }
        change("RC-JSON-TIERS-009", "added", "[generic output request]", outputTier.label, "The output contract is matched to the selected reliability tier.")

        prompt.append("\n## Final constraints")
        prompt.append("- Put the conclusion or final artifact last.")
        prompt.append("- Do not claim that a tool call, citation, or test occurred unless it occurred.")
        prompt.append("- If required information is missing, ask for it clearly rather than guessing.")
        change("RC-CONSTRAINT-END-006", "added", "[constraints scattered]", "[hard constraints at final boundary]", "Final constraints are easy to audit.")
        change("RC-DRIFT-VERSION-012", "added", "[untracked version]", "framework-2026.10.18 + selected class", "Version metadata is ready for later comparison.")

        if goal.isEmpty {
            diagnostics.append(Diagnostic(severity: .block, title: "A goal is required", message: "Enter the desired outcome before refining.", fix: "Write one sentence describing the task and output.", ruleID: "RC-POSITIVE-GUIDANCE-005"))
        }
        if modelClass == .agentic {
            diagnostics.append(Diagnostic(severity: .info, title: "Execution is simulated locally", message: "This app drafts an agent plan but does not run external tools.", fix: "Connect a reviewed sandbox adapter before live tools.", ruleID: "RC-AGENT-GOAL-STOP-003"))
        }
        if outputTier == .tier2 {
            diagnostics.append(Diagnostic(severity: .warning, title: "Tier 2 needs defensive parsing", message: "Syntax validity does not guarantee semantic validity.", fix: "Use strict schema mode where available.", ruleID: "RC-JSON-TIERS-009"))
        }

        return AppleRefinementResult(prompt: prompt.joined(separator: "\n"), modelClass: modelClass, outputTier: outputTier, citations: citations.reduce(into: []) { if !$0.contains($1) { $0.append($1) } }, changes: changes, diagnostics: diagnostics)
    }

    static func evaluate(_ variant: PromptVariant) -> EvaluationResult {
        let ids = Set(variant.citations.map(\.ruleID))
        let cases = [
            EvaluationCase(title: "Discount then tax", pass: variant.modelClass == .standard || variant.modelClass == .reasoning, reason: "Direct or Reasoning policy is available."),
            EvaluationCase(title: "Entity and monetary extraction", pass: ids.contains("RC-JSON-TIERS-009"), reason: "Structured-output tier coverage is required."),
            EvaluationCase(title: "Persona versus hard constraint", pass: ids.contains("RC-CONSTRAINT-END-006"), reason: "The final constraint rule must be present."),
            EvaluationCase(title: "Long-document change of control", pass: ids.contains("RC-CONTEXT-DELIMIT-004") && variant.modelClass == .reasoning, reason: "Reasoning plus context boundaries is required."),
            EvaluationCase(title: "Bounded repository task", pass: ids.contains("RC-AGENT-GOAL-STOP-003") && variant.modelClass == .agentic, reason: "Agent authority and stop rules are required."),
        ]
        let passed = cases.filter(\.pass).count
        return EvaluationResult(passed: passed, total: cases.count, score: passed * 100 / cases.count, notes: ["Deterministic local simulation; no live model call occurred."], cases: cases)
    }
}
