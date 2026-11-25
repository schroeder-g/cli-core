---
'@four7/cli-core': minor
---

A program builds its commands and itself from its config: `commands(config).over<Context>()` answers `leaf`, `group`, `lazyGroup`, `notBuilt` and `program`, the config's type inferred from it. This replaces `commands<C>()` and `defineProgram<C, T>(spec)`; `program(spec)` takes the spec without its `config`.

`leaf` takes one object, `leaf({ name, description, args, plan })`, in place of its four arguments; a leaf that takes nothing leaves `args` out. `group` takes one object too, `group({ name, description, commands })`, in place of its name, description and members.

A planner answers a `Plan` or an `Action` as it is, or a promise of either, so it no longer wraps one in `Promise.resolve`. So do an action's `run`, a screen's `open`, a lazy group's `load`, a step's `unless.check`, a secret's `resolve`, a chosen plan's `choose` and a check's `run`.

A program imports its parser vocabulary from `@four7/cli-core/args`: Optique's constructs, modifiers, primitives, value parsers and message helpers, `parse`, `suggest` and `getDocPage`, the types a custom value parser is written in, and cli-core's own `names`, `nameList`, `selectNamed`, `selectOne` and `timestamp`, which leave the root for it. `@optique/core` is a dependency, no longer a peer, so a program installs no Optique of its own.

`@four7/cli-core/config` re-exports zod as `z`, beside `defineConfig`, and zod is a dependency, no longer a peer: a program writes its config's schema with cli-core's `z` and installs no zod of its own.

`presentView` takes one object, `presentView({ io, refusal, view, props, from, presentation, onStderr })`, in place of its streams, refusal, module loader, component name, props builder and options. `view` is a closure that loads the component, `() => import('./View.tsx').then(module => module.View)`, so `props` is checked against that component and no type argument is spelled; the ended value's type comes from where the answer goes, or from the `exit` parameter's. `/screen` exports cli-core's own views ready to present, `checklistView` and `logViewer`, so a program writes `view: checklistView` in place of loading `/ui` and naming `'ChecklistView'`.

A program registers its own views beside its config, `commands(config, { views: { notes: () => import('./Notes.tsx').then(module => module.Notes) } })`, and the binding's `present` draws any of them, or cli-core's `checklistView` and `logViewer`, by its name: `present({ io, refusal, view: 'notes', props })`, the props checked against that view's component.

A screen belongs to its group: `group({ name, description, commands, screen })` takes the screen it opens when it is named alone on a terminal, at any depth, a lazy group's once it has loaded. `ProgramSpec.screens` and the `Screen` interface's `group` and `open` go; a program writes `screen: open` on the group in place of `screens: [{ group, open }]` on the program, and `Screen` is the function `(ctx) => number`, or a promise of it.
