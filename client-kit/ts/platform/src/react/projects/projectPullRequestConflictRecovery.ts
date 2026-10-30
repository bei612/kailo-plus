// Fixed Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/projects/projectPullRequestConflictRecovery.ts: the original copyable
// commands shown after "Resolve in Terminal" prepared the recovery refs (DD-161(1)).

function quoteShellArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Build user-visible recovery commands; callers decide whether to copy them. */
export function projectPullRequestConflictCommands({
  recoveryRef,
  targetBranch,
  targetRef,
}: {
  recoveryRef: string;
  targetBranch: string;
  targetRef: string;
}): string[] {
  const quotedTargetBranch = quoteShellArgument(targetBranch);
  const quotedTargetRef = quoteShellArgument(targetRef);
  return [
    'test -z "$(git status --porcelain=v1)" &&',
    `(git switch ${quotedTargetBranch} || git switch --create ${quotedTargetBranch} ${quotedTargetRef}) &&`,
    `git merge-base --is-ancestor HEAD ${quotedTargetRef} &&`,
    `git merge --ff-only ${quotedTargetRef} &&`,
    `git merge ${quoteShellArgument(recoveryRef)}`,
  ];
}
