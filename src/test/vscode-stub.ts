import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";

// Tests run in plain node, where the real "vscode" module doesn't exist. Import this file first.
export const vscodeStub = {
  workspace: {
    workspaceFolders: undefined as { uri: { fsPath: string } }[] | undefined,
  },
  window: {
    createOutputChannel: () => ({ appendLine: () => {} }),
    // Every message shown through withProgress or the status bar, in order.
    progress: [] as string[],
    statusBar: [] as string[],
    withProgress(
      _options: unknown,
      task: (p: { report: (v: { message?: string }) => void }) => unknown,
    ) {
      return task({
        report: (v) => v.message && this.progress.push(v.message),
      });
    },
    setStatusBarMessage(message: string) {
      this.statusBar.push(message);
    },
    errors: [] as string[],
    warnings: [] as string[],
    showWarningMessage(message: string) {
      this.warnings.push(message);
    },
    showErrorMessage(message: string) {
      this.errors.push(message);
    },
  },
  ProgressLocation: { Notification: 15 },
  commands: { executeCommand: (..._args: unknown[]): unknown => undefined },
  extensions: { getExtension: (_id: string): unknown => undefined },
};

const nodeModule = require("module");
const originalLoad = nodeModule._load;
nodeModule._load = function (request: string, ...rest: unknown[]) {
  return request === "vscode"
    ? vscodeStub
    : originalLoad.call(this, request, ...rest);
};

// Keep the clone lock and clones away from anything else on this machine.
process.env.TMPDIR = mkdtempSync(path.join(tmpdir(), "scorpio-test-"));
