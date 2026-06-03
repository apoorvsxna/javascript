Write a Clear Description
The problem should read like a real GitHub issue or engineering ticket.

Difficulty is non-negotiable. State-of-the-art AI agents should struggle with your challenge and rarely pass.
Core Requirements
Self-contained — solvable from the repo and description alone
Not already fixed in an open or merged PR
Clear — describes what to build or fix
Verifiable — success is objectively testable
Problem Checklist
1
Requirements Complete and Self-Contained
YES
Everything needed to solve the problem is present in the description
NO
Important context is missing or assumed
2
No Ambiguities, Fully Deterministic
YES
Precise and testable — one correct interpretation
NO
Vague or open to interpretation
3
Concise and Not Prescriptive
YES
Describes what, not how
NO
Prescribes specific algorithms or implementation steps
4
Matches Real-World Repo Scope
YES
Realistic issue that fits the project
NO
"Rewrite the entire auth system"
5
Aligns With Repo Design Philosophy
YES
Fits existing patterns and conventions
NO
"Adds business logic to a hooks-only framework"
6
No Irrelevant Context
YES
Focused on what matters
NO
Long narrative background or unrelated details
7
Clear Writing and Formatting
YES
Structured sections like Goal, Expected Behavior, Constraints
NO
Large unstructured paragraph
Example
Good description
Add a `--dry-run` flag to the `deploy` command that validates
the configuration and prints what would be deployed without
making any changes. The flag should work with all existing
deploy targets and respect the `--verbose` flag for additional
output.
Avoid descriptions that give away the solution. "Add a check for X if Y occurs .." tells the solver exactly where to look and how to fix it. Instead, describe the behavior, not the implementation. Unless the behavior is not obvious, in which case you can describe the implementation.
