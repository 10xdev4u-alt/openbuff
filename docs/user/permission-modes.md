# Permission Modes

A permission mode controls how much the agent does on its own and when it stops to ask you.

The mode is set per thread, from the mode control in the message composer. Changing it in one
thread does not change any other thread. A thread created from inside another thread keeps that
thread's mode; otherwise new threads start in **Full access** unless you pick something else
before sending.

## The Modes

**Supervised**: ask before commands and file changes. The agent pauses and shows you what it
wants to run or edit, and waits for approval. Work outside the workspace is restricted.

**Auto-accept edits**: auto-approve edits, ask before other actions. File changes go through
without prompting; commands and anything else still stop for approval.

**Auto**: routine actions proceed without you; risky ones still ask. The Freebuff driver enforces
this like Supervised for shell commands: anything risky still stops for an inline approval.

**Full access**: allow commands and edits without prompts. The default. The agent runs
unattended until it finishes or asks a question of its own.

Approvals appear inline in the conversation. Approve or reject one and the agent continues from
there. Approving a command "for this session" lets later commands run unasked for the rest of
that session.

## Choosing a Mode

Use **Full access** for work in a worktree or a sandbox you can throw away.

Use **Supervised** on a repository where an unwanted command is expensive, or the first time you
run an unfamiliar task.

**Auto-accept edits** suits refactors where the edits are the point and you only care about the
shell commands.

## Provider Behavior

OpenBuff ships one built-in provider (the Freebuff driver), so there is no per-provider mapping
table. The Freebuff driver enforces the modes directly: **Supervised** and **Auto** gate every
shell command behind an inline approval you resolve in the conversation, **Auto-accept edits**
additionally lets file edits through unasked, and **Full access** runs commands without
prompting. If you approve a command for the whole session, later commands in that session skip
the prompt.
