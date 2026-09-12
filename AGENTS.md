# Working in this repo

## Do not commit without being asked

Write the files. Then stop, and say what changed. Alex reads it and decides
whether it is worth a commit.

This applies to `git add` as well. Leave the working tree as it is, so the diff
is there to read.

## Conventional Commits

When a commit is asked for, the subject line is:

```
type(scope): summary in the imperative, lower case, no full stop
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `build`, `perf`,
`style`, `revert`. Scope is optional and names the part of the project touched,
for example `docs(spec)` or `feat(room)`.

Keep the subject under about 72 characters. If the change needs explaining, put
the why in a body paragraph after a blank line. A breaking change is marked with
`!` after the type or scope.

```
feat(room): relay speech frames between players

Characters carry the gap in milliseconds since the one before them, so a
hesitation survives the network instead of arriving as a block.
```
