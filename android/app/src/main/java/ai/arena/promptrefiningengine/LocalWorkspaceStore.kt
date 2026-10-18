package ai.arena.promptrefiningengine

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

class LocalWorkspaceStore(context: Context) {
    private val preferences = context.getSharedPreferences("pre_workspace", Context.MODE_PRIVATE)

    fun load(): PromptProject {
        val raw = preferences.getString("project", null) ?: return PromptProject()
        return runCatching {
            val json = JSONObject(raw)
            val variants = json.optJSONArray("variants")?.toVariantList() ?: emptyList()
            PromptProject(
                id = json.optString("id", id("project")),
                name = json.optString("name", "Untitled prompt project"),
                frameworkVersion = json.optString("frameworkVersion", "framework-2026.10.18"),
                variants = variants,
                updatedAt = json.optString("updatedAt"),
            )
        }.getOrElse { PromptProject() }
    }

    fun save(project: PromptProject) {
        // SharedPreferences is sufficient for a local-first prototype. A later
        // enterprise build can replace this class with Room or encrypted storage
        // without changing the UI/domain contract.
        preferences.edit().putString("project", project.toJson().toString()).apply()
    }

    private fun PromptProject.toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("name", name)
        put("frameworkVersion", frameworkVersion)
        put("updatedAt", updatedAt)
        put("variants", JSONArray(variants.map { it.toJson() }))
    }

    private fun PromptVariant.toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("parentId", parentId)
        put("rawGoal", rawGoal)
        put("refinedPrompt", refinedPrompt)
        put("modelClass", modelClass.name)
        put("targetModel", targetModel)
        put("outputTier", outputTier.name)
        put("createdAt", createdAt)
        put("citations", JSONArray(citations.map { citation -> JSONObject().apply { put("ruleId", citation.ruleId); put("locator", citation.locator); put("confidence", citation.confidence) } }))
        put("changes", JSONArray(changes.map { change -> JSONObject().apply { put("label", change.label); put("before", change.before); put("after", change.after); put("ruleId", change.ruleId); put("explanation", change.explanation) } }))
        put("diagnostics", JSONArray(diagnostics.map { diagnostic -> JSONObject().apply { put("severity", diagnostic.severity.name); put("title", diagnostic.title); put("message", diagnostic.message); put("fix", diagnostic.fix); put("ruleId", diagnostic.ruleId) } }))
    }

    private fun JSONArray.toVariantList(): List<PromptVariant> = (0 until length()).map { index ->
        val json = getJSONObject(index)
        PromptVariant(
            id = json.optString("id", id("variant")),
            parentId = json.optString("parentId").ifBlank { null },
            rawGoal = json.optString("rawGoal"),
            refinedPrompt = json.optString("refinedPrompt"),
            modelClass = runCatching { ModelClass.valueOf(json.optString("modelClass")) }.getOrDefault(ModelClass.STANDARD),
            targetModel = json.optString("targetModel", "standard-fast"),
            outputTier = runCatching { OutputTier.valueOf(json.optString("outputTier")) }.getOrDefault(OutputTier.TIER3),
            createdAt = json.optString("createdAt"),
            citations = json.optJSONArray("citations")?.toCitationList() ?: emptyList(),
            changes = json.optJSONArray("changes")?.toChangeList() ?: emptyList(),
            diagnostics = json.optJSONArray("diagnostics")?.toDiagnosticList() ?: emptyList(),
        )
    }

    private fun JSONArray.toCitationList(): List<Citation> = (0 until length()).map { index ->
        val item = getJSONObject(index)
        Citation(item.optString("ruleId"), item.optString("locator"), item.optString("confidence"))
    }

    private fun JSONArray.toChangeList(): List<ChangeRecord> = (0 until length()).map { index ->
        val item = getJSONObject(index)
        ChangeRecord(item.optString("label"), item.optString("before"), item.optString("after"), item.optString("ruleId"), item.optString("explanation"))
    }

    private fun JSONArray.toDiagnosticList(): List<Diagnostic> = (0 until length()).map { index ->
        val item = getJSONObject(index)
        Diagnostic(
            runCatching { Severity.valueOf(item.optString("severity")) }.getOrDefault(Severity.INFO),
            item.optString("title"), item.optString("message"), item.optString("fix"), item.optString("ruleId"),
        )
    }
}
