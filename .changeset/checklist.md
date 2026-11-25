---
'@four7/cli-core': minor
---

A program declares what needs what once and lets the user choose from it on a screen: `dependencyGraph` answers closures and dependents in the order its nodes were given, `pullingNeeds` and `pullingDependents` keep a checklist closed over it, `ChecklistView` draws the whole checklist screen in the program's words, and `chosenPlan` runs the plan a choice gives. A checklist screen's notice now clears when the cursor moves, as on every other key.
