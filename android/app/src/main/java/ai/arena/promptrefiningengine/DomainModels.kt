package ai.arena.promptrefiningengine

import java.time.Instant
import java.util.UUID

// This file mirrors shared/prompt-project.schema.json. Keeping the names aligned
// lets the Android app import the same JSON project exported by the SPA.
enum class ModelClass { STANDARD, REASONING, AGENTIC }
enum class OutputTier { TIER1, TIER2, TIER3 }
enum class Severity { BLOCK, WARNING, INFO }

data class Citation(
    val ruleId: String,
    val locator: String,
    val confidence: String,
)

data class ChangeRecord(
    val label: String,
    val before: String,
    val after: String,
    val ruleId: String,
    val explanation: String,
)

data class Diagnostic(
    val severity: Severity,
    val title: String,
    val message: String,
    val fix: String,
    val ruleId: String,
)

data class ContextBlock(
    val id: String = id("context"),
    val name: String,
    val classification: String = "untrusted-attachment",
    val text: String,
    val sha256: String,
    val status: String = "ready",
)

data class EvaluationCase(
    val title: String,
    val pass: Boolean,
    val reason: String,
)

data class EvaluationResult(
    val passed: Int,
    val total: Int,
    val score: Int,
    val notes: List<String>,
    val cases: List<EvaluationCase>,
)

data class PromptVariant(
    val id: String = id("variant"),
    val parentId: String? = null,
    val rawGoal: String,
    val refinedPrompt: String,
    val modelClass: ModelClass,
    val targetModel: String,
    val outputTier: OutputTier,
    val createdAt: String = Instant.now().toString(),
    val contextBlocks: List<ContextBlock> = emptyList(),
    val citations: List<Citation> = emptyList(),
    val changes: List<ChangeRecord> = emptyList(),
    val diagnostics: List<Diagnostic> = emptyList(),
    val evaluation: EvaluationResult? = null,
)

data class PromptProject(
    val id: String = id("project"),
    val name: String = "Untitled prompt project",
    val frameworkVersion: String = "framework-2026.10.18",
    val variants: List<PromptVariant> = emptyList(),
    val updatedAt: String = Instant.now().toString(),
)

data class RefinementResult(
    val prompt: String,
    val modelClass: ModelClass,
    val outputTier: OutputTier,
    val citations: List<Citation>,
    val changes: List<ChangeRecord>,
    val diagnostics: List<Diagnostic>,
)

fun id(prefix: String): String = "$prefix-${UUID.randomUUID()}"
