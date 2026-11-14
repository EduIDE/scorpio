import * as fs from "fs/promises";
import { parse, type ParseError } from "jsonc-parser";
import * as path from "path";
import { THEIA_PRESERVED_PATHS, withCloneLock } from "./cloning.service";

export const DEFAULT_TEMPLATES_DIR = "/home/theia/templates";

// The manifest describes the template for the image tooling and is not part of the student's project.
const TEMPLATE_MANIFEST = "template.json";

export type TemplateResult = "applied" | "not-found" | "workspace-not-empty" | "busy";

/**
 * Resolves a template id to its folder, or undefined when the id is not a plain folder name or the
 * folder does not exist. Ids with a separator or ".." never leave the templates directory.
 */
async function resolveTemplateDir(id: string, templatesDir: string): Promise<string | undefined> {
  if (!id || id === "." || id.includes("..") || /[\\/]/.test(id)) {
    return undefined;
  }
  const root = path.resolve(templatesDir);
  const dir = path.resolve(root, id);
  if (path.dirname(dir) !== root) {
    return undefined;
  }
  const stats = await fs.lstat(dir).catch(() => undefined);
  if (!stats?.isDirectory()) {
    return undefined;
  }
  // No manifest, no template.
  const manifest = await fs.lstat(path.join(dir, TEMPLATE_MANIFEST)).catch(() => undefined);
  return manifest?.isFile() ? dir : undefined;
}

/**
 * A workspace counts as empty when it only holds what Theia puts there itself, the same entries
 * a clone preserves (.theia, persisted, lost+found, .vscode/settings.json).
 */
async function isWorkspaceEmpty(workspacePath: string): Promise<boolean> {
  const preserved = new Set(THEIA_PRESERVED_PATHS.map((p) => p.split("/")[0]));
  for (const entry of await fs.readdir(workspacePath)) {
    if (!preserved.has(entry)) {
      return false;
    }
    if (entry === ".vscode") {
      const inner = await fs.readdir(path.join(workspacePath, entry));
      if (inner.some((name) => name !== "settings.json")) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Every image ships its own .vscode/settings.json, so the template's settings would be dropped.
 * Merges them: the workspace's keys are the base and the template's keys win. Both files are parsed as JSONC (comments and
 * trailing commas, as VS Code allows), so comments in the merged file are lost; if either file does not parse, the workspace file stays as it is.
 */
function parseSettings(text: string): unknown {
  const errors: ParseError[] = [];
  const value = parse(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    throw new Error("invalid JSONC");
  }
  return value;
}

async function mergeSettings(
  settingsPath: string,
  workspaceText: string,
  templateSettingsPath: string,
) {
  const templateText = await fs.readFile(templateSettingsPath, "utf8").catch(() => undefined);
  if (templateText === undefined) {
    return;
  }
  try {
    const base = parseSettings(workspaceText);
    const overrides = parseSettings(templateText);
    if ([base, overrides].some((v) => typeof v !== "object" || v === null || Array.isArray(v))) {
      throw new Error("not a JSON object");
    }
    await fs.writeFile(settingsPath, `${JSON.stringify({ ...base, ...overrides }, null, 2)}\n`);
  } catch (e: any) {
    console.warn(`Keeping the workspace .vscode/settings.json, could not merge: ${e.message}`);
  }
}

/**
 * Copies the template into an empty workspace. A restart on a persistent workspace finds files
 * and leaves them alone. Runs under the clone lock so two windows do not copy at once.
 */
export async function applyTemplate(
  id: string,
  workspacePath: string,
  templatesDir: string = DEFAULT_TEMPLATES_DIR,
  lockPath?: string,
): Promise<TemplateResult> {
  const templateDir = await resolveTemplateDir(id, templatesDir);
  if (!templateDir) {
    return "not-found";
  }

  let result: TemplateResult = "workspace-not-empty";
  const ranAlone = await withCloneLock(async () => {
    if (!(await isWorkspaceEmpty(workspacePath))) {
      return;
    }
    // A failed copy must not leave a half-filled workspace, which would count as non-empty for good.
    // Only paths the template would create are tracked, so rollback never touches other files.
    const missingBefore: string[] = [];
    for (const entry of await fs.readdir(templateDir, { recursive: true })) {
      if (entry === TEMPLATE_MANIFEST) {
        continue;
      }
      if (!(await fs.lstat(path.join(workspacePath, entry)).catch(() => undefined))) {
        missingBefore.push(entry);
      }
    }
    const settingsPath = path.join(workspacePath, ".vscode", "settings.json");
    const originalSettings = await fs.readFile(settingsPath, "utf8").catch(() => undefined);
    try {
      // force: false leaves the workspace's .vscode/settings.json alone, it is merged below.
      await fs.cp(templateDir, workspacePath, {
        recursive: true,
        force: false,
        verbatimSymlinks: true,
        filter: (source) => source !== path.join(templateDir, TEMPLATE_MANIFEST),
      });
      if (originalSettings !== undefined) {
        await mergeSettings(
          settingsPath,
          originalSettings,
          path.join(templateDir, ".vscode", "settings.json"),
        );
      }
    } catch (e) {
      if (originalSettings !== undefined) {
        await fs.writeFile(settingsPath, originalSettings);
      }
      // Deepest first, so a folder is only removed once its template files are gone and never
      // while it holds something else, such as a file the student saved meanwhile.
      for (const entry of missingBefore.sort((x, y) => y.length - x.length)) {
        const target = path.join(workspacePath, entry);
        const stats = await fs.lstat(target).catch(() => undefined);
        if (stats?.isDirectory()) {
          await fs.rmdir(target).catch(() => {});
        } else if (stats) {
          await fs.rm(target, { force: true });
        }
      }
      throw e;
    }
    await fs.chmod(path.join(workspacePath, "gradlew"), 0o755).catch(() => {});
    result = "applied";
  }, lockPath);

  return ranAlone ? result : "busy";
}
