import { execFile } from "child_process";
import * as path from "path";

const DEFAULT_LOCK_FILES = [
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "Cargo.lock",
  "Gemfile.lock",
  "composer.lock",
  "poetry.lock",
  "Pipfile.lock",
  "go.sum",
  "flake.lock",
  "pubspec.lock",
  "Podfile.lock",
  "shrinkwrap.json",
  "npm-shrinkwrap.json",
  "mix.lock",
  "packages.lock.json",
  "paket.lock",
  "gradle.lockfile",
];

const DIFF_CONCURRENCY = 5;

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(String(stderr || err.message)));
        } else {
          resolve(stdout.trim());
        }
      }
    );
  });
}

function isLockFile(
  filePath: string,
  extraLockFiles: string[]
): boolean {
  const name = path.basename(filePath);
  const lockSet = new Set([...DEFAULT_LOCK_FILES, ...extraLockFiles]);
  return lockSet.has(name);
}

function isBinaryDiff(diff: string): boolean {
  return diff.includes("Binary files") || diff.includes("GIT binary patch");
}

function truncateDiff(diff: string, maxLength: number): string {
  if (diff.length <= maxLength) {
    return diff;
  }
  return diff.slice(0, maxLength) + "\n... [truncated]";
}

async function withConcurrencyLimit<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<string>
): Promise<string[]> {
  const results: string[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

export interface GitContext {
  branch: string;
  recentCommits: string;
  changedFiles: string;
  diffs: string;
}

export async function gatherGitContext(
  cwd: string,
  maxDiffLength: number = 4000,
  recentCommitCount: number = 5,
  extraLockFiles: string[] = []
): Promise<GitContext> {
  const [branch, recentCommits, nameStatus] = await Promise.all([
    git(cwd, ["branch", "--show-current"]).catch(() => "HEAD (detached)"),
    git(cwd, ["log", "--oneline", `-${recentCommitCount}`]).catch(
      () => "(no commits yet)"
    ),
    git(cwd, ["diff", "--name-status", "--cached"]),
  ]);

  if (!nameStatus) {
    throw new Error("No staged changes found. Stage some changes first.");
  }

  const files = nameStatus
    .split("\n")
    .map((line) => {
      const renameMatch = line.match(/^R\d*\t(.+)\t(.+)$/);
      if (renameMatch) {
        return {
          status: "R",
          path: renameMatch[2],
          oldPath: renameMatch[1],
        };
      }

      const copyMatch = line.match(/^C\d*\t(.+)\t(.+)$/);
      if (copyMatch) {
        return { status: "C", path: copyMatch[2], oldPath: copyMatch[1] };
      }

      const match = line.match(/^([A-Z])\t(.+)$/);
      if (!match) return null;
      return { status: match[1], path: match[2] };
    })
    .filter((f): f is NonNullable<typeof f> => f !== null);

  const diffParts = await withConcurrencyLimit(
    files,
    DIFF_CONCURRENCY,
    async (file) => {
      if (isLockFile(file.path, extraLockFiles)) {
        return `--- ${file.path} ---\n[lock file changes omitted]`;
      }

      if (file.status === "D") {
        return `--- ${file.path} ---\n[file deleted]`;
      }

      try {
        const diff = await git(cwd, ["diff", "--cached", "--", file.path]);
        if (isBinaryDiff(diff)) {
          return `--- ${file.path} ---\n[binary file]`;
        }
        return `--- ${file.path} ---\n${truncateDiff(diff, maxDiffLength)}`;
      } catch {
        return `--- ${file.path} ---\n[could not read diff]`;
      }
    }
  );

  return {
    branch,
    recentCommits,
    changedFiles: nameStatus,
    diffs: diffParts.join("\n\n"),
  };
}

export function assembleUserMessage(
  context: GitContext,
  previousMessage?: string
): string {
  let message = "";

  if (previousMessage) {
    message += `IMPORTANT: Generate a COMPLETELY DIFFERENT commit message from the previous one. The previous message was: "${previousMessage}". Use a different type, scope, or description approach.\n\n`;
  }

  message += `Generate a commit message for the following changes:

Branch: ${context.branch}
Recent commits:
${context.recentCommits}

Changed files:
${context.changedFiles}

Diffs:
${context.diffs}`;

  return message;
}
