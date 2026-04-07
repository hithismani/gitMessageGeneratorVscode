import { execFile } from "child_process";

const LOCK_FILES = new Set([
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
]);

const MAX_DIFF_LENGTH = 4000;

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

function isLockFile(filePath: string): boolean {
  const name = filePath.split("/").pop() || filePath;
  return LOCK_FILES.has(name);
}

function isBinaryDiff(diff: string): boolean {
  return diff.includes("Binary files") || diff.includes("GIT binary patch");
}

function truncateDiff(diff: string): string {
  if (diff.length <= MAX_DIFF_LENGTH) {
    return diff;
  }
  return diff.slice(0, MAX_DIFF_LENGTH) + "\n... [truncated]";
}

export interface GitContext {
  branch: string;
  recentCommits: string;
  changedFiles: string;
  diffs: string;
}

export async function gatherGitContext(cwd: string): Promise<GitContext> {
  const [branch, recentCommits, nameStatus] = await Promise.all([
    git(cwd, ["branch", "--show-current"]).catch(() => "HEAD (detached)"),
    git(cwd, ["log", "--oneline", "-5"]).catch(() => "(no commits yet)"),
    git(cwd, ["diff", "--name-status", "--cached"]),
  ]);

  if (!nameStatus) {
    throw new Error("No staged changes found. Stage some changes first.");
  }

  const files = nameStatus
    .split("\n")
    .map((line) => {
      const match = line.match(/^([A-Z])\t(.+)$/);
      if (!match) {
        // Handle renames: R100\told\tnew
        const renameMatch = line.match(/^(R\d*)\t(.+)\t(.+)$/);
        if (renameMatch) {
          return { status: renameMatch[1], path: renameMatch[3], oldPath: renameMatch[2] };
        }
        return null;
      }
      return { status: match[1], path: match[2] };
    })
    .filter((f): f is NonNullable<typeof f> => f !== null);

  const diffParts = await Promise.all(
    files.map(async (file) => {
      if (isLockFile(file.path)) {
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
        return `--- ${file.path} ---\n${truncateDiff(diff)}`;
      } catch {
        return `--- ${file.path} ---\n[could not read diff]`;
      }
    })
  );

  return {
    branch,
    recentCommits,
    changedFiles: nameStatus,
    diffs: diffParts.join("\n\n"),
  };
}

export function assembleUserMessage(context: GitContext, previousMessage?: string): string {
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
