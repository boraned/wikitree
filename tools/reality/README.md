# Reality project runs

Both variations were requested at 5,000 nodes and both start at the English Wikipedia article **Tree**.
Both are rebuilt as complete binary trees: articles are laid out in breadth-first order and each parent receives
its next two articles. At exactly 5,000 nodes there is one final parent with one child (an even node count cannot
form a full binary tree); all other internal parents have two. This avoids long one-child chains.
Run the scripts from this repository; they use the installed Chromium and Node. Operations/cache and logs live
in `$TMPDIR/reality/` by default and are resumable. The initial crawl/design tools enforce the two-child ceiling;
`complete-tree.mjs` then creates the complete binary parent order from a project's breadth-first article order.

## Variation 1 — blue-link crawl

`node tools/reality/crawl.mjs --root Tree --nodes 5000 --max-children 2`

Fetches a page, follows Wikipedia's blue links, and chooses what to expand by the Wikipedia vital-article list,
lead placement and link frequency. The initial crawl obeys the two-child ceiling. The complete-tree pass below
keeps its breadth-first article order while rebalancing parent edges into a complete binary tree.

## Variation 2 — authored explanation

The editable topic outline is in `tree2/*.txt`. Every line declares a parent followed by its children.
The validation step checks titles and redirects with English Wikipedia and reports missing/duplicate topics.
Children are ordered as an explanation, not a link-crawl. The complete-tree pass preserves that breadth-first
article order but reassigns parent edges to remove unary chains and make the whole structure complete and binary.

`node tools/reality/design.mjs --check` validates the outline.

`node tools/reality/design.mjs --nodes 5000 --max-children 2` emits `tree2.ops.jsonl`, taking exactly the first
5,000 nodes in breadth-first order.

## Make complete binary operation files

Build each base tree in an isolated staging home, then derive complete binary operations from its BFS article order:

```sh
node tools/reality/complete-tree.mjs --project STAGED_PROJECT_ID --home /path/to/stage --out /tmp/tree1-complete.ops.jsonl
node tools/reality/complete-tree.mjs --project STAGED_PROJECT_ID --home /path/to/stage --out /tmp/tree2-complete.ops.jsonl
```

This preserves node IDs, titles, descriptions, covers and BFS order. Parent links change to the standard complete
binary layout; this guarantees a balanced, level-filled tree, not an exact taxonomy. For 5,000 nodes the result
has 2,499 parents with two children, one parent with one child, and 2,500 leaves (depth 12).

## Build and replace

After reviewing the two operation files, create separate projects (each has 5,000 wiki nodes and a at least 5,000 revisions) with the chosen project data home:

```sh
node tools/reality/build.mjs --ops /path/to/tree1.ops.jsonl --home ~/.config/WikiTree --cover 'Atom,People,Industrial Revolution,Computer,Solar System,Outer space' --fold-depth 4 --max-children 2 --label 'Tree · #1 Blue-link crawl'
node tools/reality/build.mjs --ops /path/to/tree2.ops.jsonl --home ~/.config/WikiTree --cover 'Atom,People,Industrial Revolution,Computer,Solar System,Outer space' --fold-depth 4 --max-children 2 --label 'Tree · #2 Reality outline'
```

Before rebuilding an existing project, stage and check its complete operations:

```sh
node tools/reality/complete-tree.mjs --project 05d9fad1d693 --out /tmp/tree1-complete.ops.jsonl
node tools/reality/complete-tree.mjs --project 58de1978420b --out /tmp/tree2-complete.ops.jsonl
```

Then use those operation files in the two build commands above. `--replace-project ID` reuses the existing
project ID and starts a fresh construction history; only use it after the staged build passes acceptance.

`--fold-depth 4` adds one final logged revision that collapses branches below ring 4, so the project
opens to a readable overview; all articles remain in the tree and can be expanded. `--cover` chooses the six
Wikipedia page pictures displayed on the project card. `build.mjs` verifies the complete project can be rebuilt
from its history before reporting success, and `--max-children` rejects any revision that breaks the limit.
Pass `--replace-project ID` to rebuild an existing generated project in place after staging and verifying the
new operations; it replaces that project's old nodes and history with the new construction log.

## Bundled example

New users get a smaller copy of variation #2 as the example project **Tree**: the top 10 levels of its complete
binary tree (1,023 articles), replayed with one history revision per article. Regenerate it with

```sh
node tools/reality/example-tree.mjs --project 58de1978420b
```

The source project is only read. The result goes to `src/main/example/tree/` and ships in every build;
`src/main/example.js` copies it on first launch when the user has no projects.
