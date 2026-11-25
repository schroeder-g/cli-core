---
'@four7/cli-core': minor
---

A program builds its commands and itself from its config: `commands(config).over<Context>()` answers `leaf`, `group`, `lazyGroup`, `notBuilt` and `program`, the config's type inferred from it. This replaces `commands<C>()` and `defineProgram<C, T>(spec)`; `program(spec)` takes the spec without its `config`.

`leaf` takes one object, `leaf({ name, description, args, plan })`, in place of its four arguments; a leaf that takes nothing leaves `args` out.

A planner answers a `Plan` or an `Action` as it is, or a promise of either, so it no longer wraps one in `Promise.resolve`. So do an action's `run`, a screen's `open`, a lazy group's `load`, a step's `unless.check`, a secret's `resolve`, a chosen plan's `choose` and a check's `run`.
