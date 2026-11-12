import * as vscode from "vscode";
import { exec } from "child_process";

import { ENV_KEYS, isDataBridgeEnvComplete, parseTheiaEnv, type TheiaEnv } from "./env-parsing";

export { DEFAULT_GRADLE_PREWARM, type GradlePrewarmLevel, type TheiaEnv } from "./env-parsing";

export interface TheiaEnvStrategy {
  load(): Promise<TheiaEnv>;
}

async function getEnvVariable(key: string): Promise<string | undefined> {
  try {
    return await new Promise((resolve, reject) => {
      exec(`echo $${key}`, (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          const trimmed = stdout.trim();
          // If the variable is empty, return undefined
          // to indicate the variable is not set.
          // We don't handle empty environment variables
          // as they are not valid configuration in this context.
          resolve(trimmed || undefined);
        }
      });
    });
  } catch (error) {
    console.error(`Error fetching env variable ${key}: ${error}`);
    return undefined;
  }
}

/**
 * Strategy that reads Theia environment variables from the process.
 * This is the default/legacy behavior.
 */
export class ProcessEnvStrategy implements TheiaEnvStrategy {
  async load(): Promise<TheiaEnv> {
    const env: Record<string, string | undefined> = Object.fromEntries(
      await Promise.all(
        ENV_KEYS.map((key) => getEnvVariable(key).then((value) => [key, value] as const)),
      ),
    );
    return parseTheiaEnv(env);
  }
}

/**
 * Strategy that polls the data bridge extension for environment variables.
 * Used when SCORPIO_THEIA_ENV_STRATEGY=data-bridge.
 */
export class DataBridgeStrategy implements TheiaEnvStrategy {
  private static readonly DATA_BRIDGE_EXTENSION_ID = "tum-aet.data-bridge";
  private static readonly COMMAND = "dataBridge.getEnv";
  private static readonly POLL_INTERVAL_MS = 500;
  private static readonly TIMEOUT_MS = 10000;

  private outputChannel: vscode.OutputChannel;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel("Scorpio Environment Variables");
  }

  async load(): Promise<TheiaEnv> {
    this.outputChannel.appendLine("Using data bridge strategy");

    const dataBridgeExt = vscode.extensions.getExtension(
      DataBridgeStrategy.DATA_BRIDGE_EXTENSION_ID,
    );
    if (!dataBridgeExt) {
      this.outputChannel.appendLine(
        "Data bridge extension not installed, falling back to process env",
      );
      vscode.window.showWarningMessage(
        "Data bridge not available, falling back to process environment variables",
      );
      return new ProcessEnvStrategy().load();
    }

    if (!dataBridgeExt.isActive) {
      this.outputChannel.appendLine("Activating data bridge extension...");
      await dataBridgeExt.activate();
    }

    this.outputChannel.appendLine("Data bridge active, polling for environment variables...");
    return this.pollForEnvironmentVariables();
  }

  private async pollForEnvironmentVariables(): Promise<TheiaEnv> {
    const startTime = Date.now();

    while (Date.now() - startTime < DataBridgeStrategy.TIMEOUT_MS) {
      const env = await this.fetchEnvironmentVariables();

      // The operator delivers a session's variables in one injection, so the first one
      // to arrive means the rest are there too (see isDataBridgeEnvComplete).
      if (isDataBridgeEnvComplete(env)) {
        this.outputChannel.appendLine("Environment variables received from bridge");
        return parseTheiaEnv(env, true);
      }

      this.outputChannel.appendLine(
        `Waiting for environment variables... (${Math.round((Date.now() - startTime) / 1000)}s)`,
      );
      await this.sleep(DataBridgeStrategy.POLL_INTERVAL_MS);
    }

    this.outputChannel.appendLine(
      "Timeout waiting for environment variables, falling back to process env",
    );
    return new ProcessEnvStrategy().load();
  }

  private async fetchEnvironmentVariables(): Promise<Record<string, string | undefined>> {
    try {
      const result = await vscode.commands.executeCommand<Record<string, string>>(
        DataBridgeStrategy.COMMAND,
        [...ENV_KEYS],
      );
      return result ?? {};
    } catch (error) {
      this.outputChannel.appendLine(`Error fetching environment variables: ${error}`);
      return {};
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Factory function to create the appropriate theia environment strategy
 * based on the SCORPIO_THEIA_ENV_STRATEGY environment variable.
 */
export async function createTheiaEnvStrategy(): Promise<TheiaEnvStrategy> {
  const strategy = await getEnvVariable("SCORPIO_THEIA_ENV_STRATEGY");
  if (strategy === "data-bridge") {
    return new DataBridgeStrategy();
  } else {
    return new ProcessEnvStrategy();
  }
}
