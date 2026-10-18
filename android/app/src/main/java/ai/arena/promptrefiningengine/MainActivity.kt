package ai.arena.promptrefiningengine

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Divider
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { PromptRefiningEngineTheme { PromptEngineApp() } }
    }
}

private val Canvas = Color(0xFF07111F)
private val Panel = Color(0xFF0D1B2D)
private val Teal = Color(0xFF7EE1D0)
private val Muted = Color(0xFF9AAEC4)

@Composable
private fun PromptRefiningEngineTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = androidx.compose.material3.darkColorScheme(
            background = Canvas,
            surface = Panel,
            primary = Teal,
            onPrimary = Canvas,
            onSurface = Color(0xFFEAF3FF),
            onBackground = Color(0xFFEAF3FF),
        ),
        content = content,
    )
}

@Composable
private fun PromptEngineApp() {
    val context = LocalContext.current
    val store = remember { LocalWorkspaceStore(context) }
    var project by remember { mutableStateOf(store.load()) }
    var selectedTab by rememberSaveable { mutableIntStateOf(0) }
    var rawGoal by rememberSaveable { mutableStateOf(project.variants.lastOrNull()?.rawGoal.orEmpty()) }
    var refinedPrompt by rememberSaveable { mutableStateOf(project.variants.lastOrNull()?.refinedPrompt.orEmpty()) }
    var modelClass by rememberSaveable { mutableStateOf(project.variants.lastOrNull()?.modelClass ?: ModelClass.STANDARD) }
    var outputTier by rememberSaveable { mutableStateOf(project.variants.lastOrNull()?.outputTier ?: OutputTier.TIER3) }
    var contextBlocks by remember { mutableStateOf(project.variants.lastOrNull()?.contextBlocks ?: emptyList()) }
    var activeVariant by remember { mutableStateOf(project.variants.lastOrNull()) }
    var evaluation by remember { mutableStateOf(activeVariant?.evaluation) }
    var notice by remember { mutableStateOf("Local-first workspace ready. No provider credentials are connected.") }

    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        runCatching {
            val text = context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }.orEmpty()
            val block = ContextBlock(name = uri.lastPathSegment ?: "attached-file", text = text, sha256 = "local-hash-pending")
            contextBlocks = contextBlocks + block
            notice = "Attachment read locally and marked as untrusted data."
        }.onFailure { notice = "The attachment could not be read by this device." }
    }

    fun refine() {
        val result = PromptEngine.refine(rawGoal, contextBlocks, modelClass, outputTier)
        val variant = PromptVariant(
            parentId = activeVariant?.id,
            rawGoal = rawGoal,
            refinedPrompt = result.prompt,
            modelClass = result.modelClass,
            targetModel = "android-local-policy",
            outputTier = result.outputTier,
            contextBlocks = contextBlocks,
            citations = result.citations,
            changes = result.changes,
            diagnostics = result.diagnostics,
        )
        activeVariant = variant
        refinedPrompt = result.prompt
        project = project.copy(variants = project.variants + variant, updatedAt = variant.createdAt)
        store.save(project)
        evaluation = null
        notice = "Created a ${if (variant.parentId == null) "root" else "branch"} variant. No provider call occurred."
    }

    Scaffold(
        topBar = {
            TopAppBar(title = { Column { Text("Prompt Refining Engine", fontWeight = FontWeight.Bold); Text("v1.5.1 · source-cited local workspace", fontSize = 11.sp, color = Teal) } })
        },
        bottomBar = {
            NavigationBar(containerColor = Panel) {
                listOf("Workbench", "Review", "Linter", "History", "Eval", "Evidence").forEachIndexed { index, label ->
                    NavigationBarItem(selected = selectedTab == index, onClick = { selectedTab = index }, icon = { Text("0${index + 1}", fontSize = 10.sp) }, label = { Text(label, fontSize = 10.sp) })
                }
            }
        },
        containerColor = Canvas,
    ) { padding ->
        Column(Modifier.fillMaxSize().background(Canvas).padding(padding).padding(horizontal = 16.dp)) {
            Text(notice, color = Muted, fontSize = 11.sp, modifier = Modifier.padding(vertical = 9.dp))
            when (selectedTab) {
                0 -> WorkbenchScreen(rawGoal, { rawGoal = it }, modelClass, { modelClass = it }, outputTier, { outputTier = it }, contextBlocks, { filePicker.launch(arrayOf("text/*", "application/json")) }, { contextBlocks = contextBlocks - it }, refinedPrompt, activeVariant, ::refine)
                1 -> ReviewScreen(activeVariant)
                2 -> LinterScreen(activeVariant)
                3 -> HistoryScreen(project, activeVariant, { selected -> activeVariant = selected; rawGoal = selected.rawGoal; refinedPrompt = selected.refinedPrompt; modelClass = selected.modelClass; outputTier = selected.outputTier; contextBlocks = selected.contextBlocks; selectedTab = 0 })
                4 -> EvaluationScreen(activeVariant, evaluation, { activeVariant?.let { evaluation = PromptEngine.evaluate(it); notice = "Local regression suite complete." } })
                else -> EvidenceScreen()
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun WorkbenchScreen(
    rawGoal: String,
    onGoalChange: (String) -> Unit,
    modelClass: ModelClass,
    onClassChange: (ModelClass) -> Unit,
    outputTier: OutputTier,
    onTierChange: (OutputTier) -> Unit,
    contextBlocks: List<ContextBlock>,
    onAttach: () -> Unit,
    onRemoveContext: (ContextBlock) -> Unit,
    refinedPrompt: String,
    variant: PromptVariant?,
    onRefine: () -> Unit,
) {
    LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxSize().padding(bottom = 12.dp)) {
        item { SectionHeading("01 / WORKBENCH", "Make every refinement reviewable", "This offline engine applies the approved rule registry. It does not call an external AI provider.") }
        item {
            Card(colors = CardDefaults.cardColors(containerColor = Panel)) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(11.dp)) {
                    OutlinedTextField(rawGoal, onGoalChange, label = { Text("Raw goal or draft prompt") }, placeholder = { Text("Example: Extract risks from a contract into strict JSON.") }, modifier = Modifier.fillMaxWidth(), minLines = 6)
                    LabeledDropdown("Behavioral class", modelClass.name.lowercase().replaceFirstChar { it.uppercase() }, ModelClass.entries.toList(), { it.name.lowercase().replaceFirstChar { c -> c.uppercase() } }, onClassChange)
                    LabeledDropdown("Output reliability tier", outputTier.name, OutputTier.entries.toList(), { it.name }, onTierChange)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = onAttach) { Text("Attach text / JSON") }
                        Text("Files stay local and untrusted.", color = Muted, fontSize = 11.sp, modifier = Modifier.padding(top = 12.dp))
                    }
                    contextBlocks.forEach { block ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("${block.name} · ${block.status}", color = Muted, fontSize = 11.sp)
                            OutlinedButton(onClick = { onRemoveContext(block) }) { Text("Remove", fontSize = 10.sp) }
                        }
                    }
                    Button(onClick = onRefine, modifier = Modifier.fillMaxWidth()) { Text(if (variant == null) "Refine with local policy engine" else "Create new refined branch") }
                }
            }
        }
        item {
            Card(colors = CardDefaults.cardColors(containerColor = Panel)) {
                Column(Modifier.padding(14.dp)) {
                    SectionHeading("02 / OUTPUT", "Refined production prompt", "The text below is a deterministic draft with citations, not a live model response.")
                    if (refinedPrompt.isBlank()) Text("No refinement yet.", color = Muted, modifier = Modifier.padding(vertical = 28.dp))
                    else Surface(color = Canvas, modifier = Modifier.fillMaxWidth()) { Text(refinedPrompt, fontFamily = FontFamily.Monospace, fontSize = 11.sp, lineHeight = 17.sp, modifier = Modifier.padding(12.dp)) }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun <T> LabeledDropdown(label: String, selectedLabel: String, values: List<T>, labelOf: (T) -> String, onSelected: (T) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = !expanded }) {
        OutlinedTextField(selectedLabel, {}, readOnly = true, label = { Text(label) }, trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) }, modifier = Modifier.menuAnchor().fillMaxWidth())
        ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) { values.forEach { value -> DropdownMenuItem(text = { Text(labelOf(value)) }, onClick = { onSelected(value); expanded = false }) } }
    }
}

@Composable
private fun ReviewScreen(variant: PromptVariant?) {
    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxSize()) {
        item { SectionHeading("02 / REVIEW", "Changes and citations", "Every transformation should point back to a registry rule.") }
        if (variant == null) item { EmptyCard("Refine a prompt first") }
        else {
            item { Text("${variant.changes.size} changes · ${variant.citations.size} citations", color = Teal, fontSize = 12.sp) }
            items(variant.changes) { change ->
                Card(colors = CardDefaults.cardColors(containerColor = Panel)) { Column(Modifier.padding(12.dp)) { Text("${change.label.uppercase()} · ${change.ruleId}", color = Teal, fontFamily = FontFamily.Monospace, fontSize = 10.sp); Text(change.explanation, color = Muted, fontSize = 12.sp, modifier = Modifier.padding(vertical = 6.dp)); Text("Before: ${change.before}", color = Muted, fontSize = 10.sp); Text("After: ${change.after}", color = Color(0xFFBFEFE4), fontSize = 10.sp, modifier = Modifier.padding(top = 4.dp)) } }
            }
        }
    }
}

@Composable
private fun LinterScreen(variant: PromptVariant?) {
    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxSize()) {
        item { SectionHeading("03 / LINTER", "Pre-flight checks", "Warnings are deterministic and illustrative; provider pricing must be verified before production.") }
        if (variant == null) item { EmptyCard("Refine a prompt first") }
        else {
            val plan = variant.refinedPrompt.length / 4
            item { Card(colors = CardDefaults.cardColors(containerColor = Panel)) { Column(Modifier.padding(14.dp)) { Text("${String.format("%,d", plan)} estimated input tokens", fontWeight = FontWeight.Bold); Text("Class: ${variant.modelClass} · Tier: ${variant.outputTier}", color = Muted, fontSize = 12.sp); Divider(Modifier.padding(vertical = 9.dp)); Text("Context headroom: reserve output and reasoning budget before dispatch.", color = Teal, fontSize = 12.sp); Text("Provider adapter: not connected", color = Color(0xFFFFBF73), fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp)) } } }
            items(variant.diagnostics) { diagnostic -> DiagnosticCard(diagnostic) }
        }
    }
}

@Composable
private fun HistoryScreen(project: PromptProject, activeVariant: PromptVariant?, onSelect: (PromptVariant) -> Unit) {
    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxSize()) {
        item { SectionHeading("04 / HISTORY", project.name, "Local snapshots preserve parent/child branches and the rule registry version.") }
        if (project.variants.isEmpty()) item { EmptyCard("No saved variants") }
        items(project.variants.reversed()) { variant -> Card(colors = CardDefaults.cardColors(containerColor = if (variant.id == activeVariant?.id) Color(0xFF143C4A) else Panel)) { Column(Modifier.padding(12.dp)) { Text(variant.rawGoal.take(100), fontWeight = FontWeight.Bold); Text("${variant.modelClass} · ${variant.citations.size} citations", color = Muted, fontSize = 11.sp, modifier = Modifier.padding(vertical = 5.dp)); OutlinedButton(onClick = { onSelect(variant) }) { Text("Open branch") } } } }
    }
}

@Composable
private fun EvaluationScreen(variant: PromptVariant?, evaluation: EvaluationResult?, onRun: () -> Unit) {
    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxSize()) {
        item { SectionHeading("05 / EVAL + SAFETY", "Measure before you trust", "This is a local simulation of the five supplied regression cases, not an LLM judge.") }
        if (variant == null) item { EmptyCard("Refine a prompt first") }
        else {
            item { Button(onClick = onRun, modifier = Modifier.fillMaxWidth()) { Text("Run local regression suite") } }
            if (evaluation == null) item { EmptyCard("No evaluation yet") }
            else {
                item { Text("${evaluation.passed}/${evaluation.total} passed · ${evaluation.score}%", color = Teal, fontSize = 18.sp, fontWeight = FontWeight.Bold) }
                items(evaluation.cases) { item -> Card(colors = CardDefaults.cardColors(containerColor = Panel)) { Row(Modifier.padding(12.dp)) { Text(if (item.pass) "✓" else "×", color = if (item.pass) Color(0xFF82D5A4) else Color(0xFFFF8A89), fontSize = 20.sp); Column(Modifier.padding(start = 10.dp)) { Text(item.title, fontWeight = FontWeight.Bold); Text(item.reason, color = Muted, fontSize = 11.sp) } } } }
            }
        }
    }
}

@Composable
private fun EvidenceScreen() {
    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxSize()) {
        item { SectionHeading("06 / EVIDENCE", "Framework registry", "The registry is inspectable data. Source dates and confidence prevent unverified claims from looking permanent.") }
        item { Text("Ten core rules are mirrored in the Android fallback engine and in shared/framework-rules.json.", color = Muted, fontSize = 12.sp) }
        listOf("RC-REASONING-ZERO-SHOT-001", "RC-CONTEXT-DELIMIT-004", "RC-JSON-TIERS-009", "RC-AGENT-GOAL-STOP-003", "RC-DRIFT-VERSION-012").forEach { rule -> item { Card(colors = CardDefaults.cardColors(containerColor = Panel)) { Text(rule, color = Teal, fontFamily = FontFamily.Monospace, fontSize = 11.sp, modifier = Modifier.padding(12.dp)) } } }
    }
}

@Composable
private fun DiagnosticCard(diagnostic: Diagnostic) {
    Card(colors = CardDefaults.cardColors(containerColor = Panel)) { Column(Modifier.padding(12.dp)) { Text("${diagnostic.severity} · ${diagnostic.title}", color = if (diagnostic.severity == Severity.BLOCK) Color(0xFFFF8A89) else Teal, fontWeight = FontWeight.Bold); Text(diagnostic.message, color = Muted, fontSize = 11.sp, modifier = Modifier.padding(vertical = 5.dp)); Text("Fix: ${diagnostic.fix}", color = Color(0xFFFFBF73), fontSize = 10.sp) } }
}

@Composable
private fun SectionHeading(kicker: String, title: String, description: String) {
    Column(Modifier.padding(vertical = 5.dp)) { Text(kicker, color = Teal, fontFamily = FontFamily.Monospace, fontSize = 10.sp); Text(title, fontSize = 24.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 5.dp)); Text(description, color = Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 5.dp)) }
}

@Composable
private fun EmptyCard(text: String) { Card(colors = CardDefaults.cardColors(containerColor = Panel)) { Text(text, color = Muted, modifier = Modifier.padding(24.dp)) } }
