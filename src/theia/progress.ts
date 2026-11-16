import * as vscode from "vscode";

/** Shows a non-cancellable notification titled "Preparing your workspace" while `task` runs. */
export function withWorkspaceProgress<T>(
  task: (report: (message: string) => void) => Promise<T>,
): Thenable<T> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Preparing your workspace",
      cancellable: false,
    },
    (progress) => task((message) => progress.report({ message })),
  );
}
