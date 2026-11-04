---
name: project-update
description: Turn finished engineering work into a paste-ready update for the project manager in Claude chat, organized by the living project doc's tabs (Project Description, Project Plan, Improvements). Use when the user runs /project-update or says they finished a change or feature, want to wrap up, hand off, update the PM, update the project doc, or send a status update, even if they don't say "project update".
---

# Project Update

Claude Code is the engineer. A Claude chat project is the program manager and keeps the living project doc. This skill is the handoff: one block of text the user copies from here and pastes into that chat. The PM can't see the code or this session, so the update has to make sense without them.

## Steps

1. **Gather the facts.** Use this session's history, plus these read-only commands if the folder is a git repo:
   - `git status --short`
   - `git diff --stat`, adding `--staged` if changes are staged
   - `git log --oneline -10`
   - `git branch --show-current`

   Read `CLAUDE.md` or the README if you need the project name or context. If the work isn't clear from these, ask the user one short question.

2. **Sort each fact into the tab where it belongs.**
   - **Project Description** holds what the product is now: current features and the data model. Only list changes a user would notice or changes to stored data.
   - **Project Plan** holds what was completed and what comes next.
   - **Improvements** holds bugs and feature requests, both new and resolved.

3. **Write the update using the template below.** Put it in a single code block so it copies cleanly on a phone or tablet. Add nothing after the block except one line: `Paste this into your project chat.`

4. **Stop there.** Don't commit, push, or edit project docs as part of this skill. The update only reports the work.

## Template

Keep every heading so the PM can rely on the structure. Write `None` under any empty field.

```
PROJECT UPDATE
Please apply this to the living project doc, tab by tab. Then tell me what you changed and raise anything under Decisions Needed.

Project: [name]
Date: [YYYY-MM-DD]
Branch / commit: [branch, short hash, or "uncommitted"]
Status: [Complete | Partly complete | Blocked]
Summary: [1-2 plain-language sentences on what changed and why it matters]

PROJECT DESCRIPTION TAB
Current features added or changed:
- [what the user can now do]
Current features removed:
- [item]
Data model changes:
- [new or changed field, and what it stores]

PROJECT PLAN TAB
Completed:
- [plan item finished]
Add to next steps:
- [new item, in suggested priority order]
Remove from next steps:
- [item no longer needed, and why]

IMPROVEMENTS TAB
Bugs fixed:
- [item]
New bugs or known issues:
- [what happens, and when]
New feature requests:
- [item]
Feature requests completed:
- [item]

DECISIONS
Decisions made:
- [what was chosen, and why]
Decisions needed:
- [question, options, and the engineer's recommendation]

TESTING
Tested:
- [what was run or checked, and the result]
Not tested:
- [what still needs checking, such as on a real device]

FILES CHANGED
- [path]: [what changed, in a few words]
```

## Writing guidelines

- **Report only what happened.** The PM will record this as fact, so don't call something tested unless it was run in this session or the user said they checked it. Put anything else under `Not tested`.
- **Match status to reality.** Use `Complete` only when the planned work is done and has been checked. Use `Partly complete` if it runs but pieces are missing or untested.
- **Describe outcomes, not code.** Write "Tapping a step shows only that step's ingredients" rather than "Added StepIngredientsPopup component." Technical detail belongs under `FILES CHANGED`.
- **Flag big choices.** Put any architecture, storage, or platform choice under `Decisions needed`. If one was already made during the work, list it under `Decisions made` so the PM can review it.
- **Keep suggestions labeled.** Next steps you propose are suggestions; the PM and the user set the plan.
- **Keep it short.** Use one line per bullet and group small related edits. List key files only, and leave out generated files and lockfiles.
- **Leave out sensitive or bulky content.** Don't include secrets, API keys, personal data, or pasted code.

## Example

The user says: "Step popups are working, let's wrap up."

```
PROJECT UPDATE
Please apply this to the living project doc, tab by tab. Then tell me what you changed and raise anything under Decisions Needed.

Project: Cookbook
Date: 2026-11-04
Branch / commit: main, a1b2c3d
Status: Complete
Summary: Tapping a direction step now opens a popup with only that step's ingredients, so you can cook without scrolling back to the full list.

PROJECT DESCRIPTION TAB
Current features added or changed:
- Tapping a direction step opens a popup with that step's ingredients
Current features removed:
None
Data model changes:
- Each direction step now stores a list of the ingredients it uses

PROJECT PLAN TAB
Completed:
- Step-level ingredient popups
Add to next steps:
- Let users assign ingredients to a step when editing a recipe
Remove from next steps:
None

IMPROVEMENTS TAB
Bugs fixed:
None
New bugs or known issues:
- Popup can run off screen when a step has more than 10 ingredients
New feature requests:
None
Feature requests completed:
- Step-level ingredient popups

DECISIONS
Decisions made:
- Popup closes on a tap outside it, which keeps the screen uncluttered
Decisions needed:
None

TESTING
Tested:
- Opened and closed popups on three sample recipes in the browser; all worked
Not tested:
- On the iPad itself

FILES CHANGED
- src/components/StepPopup.js: new popup
- src/data/recipes.js: added ingredients to each step
```
