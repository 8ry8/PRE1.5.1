import Foundation
import Observation

@Observable
final class WorkspaceStore {
    var project: PromptProject = PromptProject()

    init() {
        load()
    }

    func load() {
        guard let data = UserDefaults.standard.data(forKey: "pre-v1-5-1-project"),
              let saved = try? JSONDecoder().decode(PromptProject.self, from: data) else { return }
        project = saved
    }

    func save() {
        guard let data = try? JSONEncoder().encode(project) else { return }
        UserDefaults.standard.set(data, forKey: "pre-v1-5-1-project")
    }

    func add(_ variant: PromptVariant) {
        project.variants.removeAll { $0.id == variant.id }
        project.variants.append(variant)
        project.updatedAt = Date()
        save()
    }

    func rename(_ name: String) {
        project.name = name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Untitled prompt project" : name
        project.updatedAt = Date()
        save()
    }
}
