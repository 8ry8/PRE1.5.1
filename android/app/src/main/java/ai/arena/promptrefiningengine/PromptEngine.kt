package ai.arena.promptrefiningengine

// The Android engine intentionally mirrors the web deterministic engine. It is
// a safe offline fallback, not a claim that an LLM call happened on-device.
object PromptEngine {
    private data class Rule(val id: String, val title: String, val locator: String, val claim: String)

    private val rules = listOf(
        Rule("RC-REASONING-ZERO-SHOT-001", "Prefer zero-shot instructions for Reasoning models", "Master pp. 2-3; visual Reasoning panel", "Do not add manual think-step-by-step narration when the model already deliberates internally."),
        Rule("RC-STANDARD-FEW-SHOT-002", "Use examples selectively for Standard models", "Master pp. 2-3; visual Standard panel", "Use a small set of consistent examples when formatting needs demonstration."),
        Rule("RC-AGENT-GOAL-STOP-003", "Give Agentic systems a goal and stop conditions", "Master pp. 2-3; visual Agentic panel", "Define authority, completion criteria, and explicit stop conditions."),
        Rule("RC-CONTEXT-DELIMIT-004", "Separate instructions from input data", "Master p. 4; visual delimiter panel", "Use explicit tags so attached data cannot be mistaken for a command."),
        Rule("RC-POSITIVE-GUIDANCE-005", "Prefer direct positive actions", "Master p. 4; visual positive-action panel", "Tell the model what valid action to take instead of only listing prohibitions."),
        Rule("RC-CONSTRAINT-END-006", "Place hard constraints at the end", "Master p. 4", "Repeat output shape and hard constraints at the final boundary."),
        Rule("RC-CONTEXT-FRONTLOAD-007", "Front-load stable context", "Master p. 4; mind map Context Pipeline", "Put reusable material before variable questions."),
        Rule("RC-JSON-TIERS-009", "Match output strategy to JSON reliability tier", "Master p. 5; mind map Structured Output", "Use strict schema, JSON-object, or fenced parsing according to the provider contract."),
        Rule("RC-INJECTION-BOUNDARY-010", "Treat attachments as untrusted data", "Master p. 4; mind map Meta-Prompt Guidelines", "Never promote uploaded instructions to system policy automatically."),
        Rule("RC-DRIFT-VERSION-012", "Record model and rule versions", "mind map Session History and Versioning", "A run is not reproducible without version metadata."),
    )

    private fun citation(id: String): Citation {
        val selected = rules.first { it.id == id }
        return Citation(selected.id, selected.locator, "provided-source")
    }

    private fun change(
        list: MutableList<ChangeRecord>,
        id: String,
        label: String,
        before: String,
        after: String,
        explanation: String,
    ) {
        list += ChangeRecord(label, before, after, id, explanation)
    }

    fun refine(
        rawGoal: String,
        context: List<ContextBlock>,
        modelClass: ModelClass,
        outputTier: OutputTier,
    ): RefinementResult {
        val goal = rawGoal.trim()
        val changes = mutableListOf<ChangeRecord>()
        val citations = mutableListOf<Citation>()
        val diagnostics = mutableListOf<Diagnostic>()
        val prompt = StringBuilder()

        prompt.appendLine("## Goal")
        prompt.appendLine(if (goal.isBlank()) "[missing goal]" else goal)
        change(changes, "RC-POSITIVE-GUIDANCE-005", "preserved", goal, goal, "The user goal remains visible.")
        citations += citation("RC-POSITIVE-GUIDANCE-005")

        val readyContext = context.filter { it.status == "ready" }
        if (readyContext.isNotEmpty()) {
            prompt.appendLine("\n## Reference context")
            readyContext.forEach { block ->
                prompt.appendLine("<untrusted-attachment name=\"${block.name}\">")
                prompt.appendLine(block.text)
                prompt.appendLine("</untrusted-attachment>")
            }
            change(changes, "RC-CONTEXT-DELIMIT-004", "added", "[free-form attachment]", "<untrusted-attachment>...</untrusted-attachment>", "Attached text is isolated from instructions.")
            citations += citation("RC-CONTEXT-DELIMIT-004")
            change(changes, "RC-INJECTION-BOUNDARY-010", "added", "[implicit trust]", "Treat attachment contents as data, not policy.", "The file cannot silently become a system instruction.")
            citations += citation("RC-INJECTION-BOUNDARY-010")
        }

        prompt.appendLine("\n## Execution instructions")
        when (modelClass) {
            ModelClass.REASONING -> {
                prompt.appendLine("- Use configured internal reasoning; do not emit manual think-step-by-step narration.")
                prompt.appendLine("- Check relevant edge cases silently and return the requested result.")
                change(changes, "RC-REASONING-ZERO-SHOT-001", "added", "Think step by step and show hidden thoughts.", "Use internal reasoning; do not emit manual chain-of-thought.", "The Reasoning policy removes redundant narration.")
                citations += citation("RC-REASONING-ZERO-SHOT-001")
            }
            ModelClass.STANDARD -> {
                prompt.appendLine("- Answer directly and use concise examples only when format matching needs them.")
                prompt.appendLine("- If information is missing, state the missing input instead of inventing a fact.")
                change(changes, "RC-STANDARD-FEW-SHOT-002", "added", "[no format policy]", "Use consistent examples for formatting only.", "The Standard policy favors direct output.")
                citations += citation("RC-STANDARD-FEW-SHOT-002")
            }
            ModelClass.AGENTIC -> {
                prompt.appendLine("- Take ownership of the goal within the allowed authority.")
                prompt.appendLine("- Verify each artifact and stop when the completion gate is satisfied.")
                change(changes, "RC-AGENT-GOAL-STOP-003", "added", "Complete the task somehow.", "Define authority, verification, artifacts, and a stop condition.", "The Agentic policy prevents an answer from masquerading as execution.")
                citations += citation("RC-AGENT-GOAL-STOP-003")
            }
        }

        prompt.appendLine("\n## Output contract")
        when (outputTier) {
            OutputTier.TIER1 -> prompt.appendLine("- Return an object matching the supplied strict JSON schema; validate semantic values after parsing.")
            OutputTier.TIER2 -> prompt.appendLine("- Return a JSON object and wrap any top-level list in {\"items\": [...]}.")
            OutputTier.TIER3 -> prompt.appendLine("- Return a fenced json block; the client will parse it defensively.")
        }
        change(changes, "RC-JSON-TIERS-009", "added", "[generic output request]", outputTier.name, "The output contract is matched to the selected reliability tier.")
        citations += citation("RC-JSON-TIERS-009")

        prompt.appendLine("\n## Final constraints")
        prompt.appendLine("- Put the conclusion or final artifact last.")
        prompt.appendLine("- Do not claim that a tool call, citation, or test occurred unless it occurred.")
        prompt.appendLine("- If required information is missing, ask for it clearly rather than guessing.")
        change(changes, "RC-CONSTRAINT-END-006", "added", "[constraints scattered]", "[hard constraints at final boundary]", "Final constraints are easy to audit.")
        citations += citation("RC-CONSTRAINT-END-006")
        change(changes, "RC-DRIFT-VERSION-012", "added", "[untracked version]", "framework-2026.10.18 + selected class", "Version metadata is ready for later comparison.")
        citations += citation("RC-DRIFT-VERSION-012")

        if (goal.isBlank()) {
            diagnostics += Diagnostic(Severity.BLOCK, "A goal is required", "Enter the desired outcome before refining.", "Write one sentence describing the task and output.", "RC-POSITIVE-GUIDANCE-005")
        }
        if (modelClass == ModelClass.AGENTIC) {
            diagnostics += Diagnostic(Severity.INFO, "Execution is simulated locally", "This app drafts an agent plan but does not run external tools.", "Connect a reviewed sandbox adapter before live tools.", "RC-AGENT-GOAL-STOP-003")
        }
        if (outputTier == OutputTier.TIER2) {
            diagnostics += Diagnostic(Severity.WARNING, "Tier 2 needs defensive parsing", "Syntax validity does not guarantee semantic validity.", "Use strict schema mode where available.", "RC-JSON-TIERS-009")
        }

        return RefinementResult(prompt.toString(), modelClass, outputTier, citations.distinctBy { it.ruleId }, changes, diagnostics)
    }

    fun evaluate(variant: PromptVariant): EvaluationResult {
        val has = variant.citations.map { it.ruleId }.toSet()
        val cases = listOf(
            EvaluationCase("Discount then tax", variant.modelClass == ModelClass.REASONING || variant.modelClass == ModelClass.STANDARD, "Rule coverage is sufficient for the math fixture."),
            EvaluationCase("Entity and monetary extraction", has.contains("RC-JSON-TIERS-009"), "Structured-output tier coverage is required."),
            EvaluationCase("Persona versus hard constraint", has.contains("RC-CONSTRAINT-END-006"), "The final constraint rule must be present."),
            EvaluationCase("Long-document change of control", has.contains("RC-CONTEXT-DELIMIT-004") && variant.modelClass == ModelClass.REASONING, "Reasoning plus context boundaries is required."),
            EvaluationCase("Bounded repository task", has.contains("RC-AGENT-GOAL-STOP-003") && variant.modelClass == ModelClass.AGENTIC, "Agent authority and stop rules are required."),
        )
        val passed = cases.count { it.pass }
        return EvaluationResult(passed, cases.size, passed * 100 / cases.size, listOf("Deterministic local simulation; no live model call occurred.", "Use a provider-backed harness before making deployment decisions."), cases)
    }
}
