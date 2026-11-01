# Source and task-state resolution

Published 2 November 2026. This is a routing note, not a frozen fleet manifest or standing approval.

- Repository: 1Sirkkris/-tampermonkey-v2. Default editable repository branch: main unless the user specifies another target.
- Resolve the live target branch HEAD, exact file/version and relevant dependencies before edits or publication. Record that baseline in the task receipt.
- Distinguish repository source, latest delivered candidate and last user-confirmed working runtime. A newer Copy Code delivery may not yet be on GitHub; published source may not be installed.
- Recover using the latest relevant task-specific record and original evidence available to the worker. Do not treat stale October approval/recovery snapshots as current fleet-wide instructions.
- If newer delivered/runtime source differs materially, reconcile it before editing; do not overwrite a working candidate with stale repository code. If source cannot be established, continue diagnosis but do not guess an implementation.
- Installed state and live acceptance are unknown until supported by actual runtime/user evidence.
- GitHub-free infrastructure replacement remains separate work: establish canonical source, version history, dependencies and rollback before changing the existing update mechanism.
- Rule publication changes no userscript identity, version, update URL, installation or live workflow. Branches retain their own code; do not synchronise scripts as part of instruction alignment.

Keep changing task facts in the task's dated recovery/verification record, not in permanent operating rules.
