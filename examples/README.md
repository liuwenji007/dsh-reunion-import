# Demo export (fictional)

This directory is a small, entirely fictional DeepSeek-format export used by the
README examples and by tests. It contains no real conversation data.

- `demo-companion` — a short companionship thread used for the persona flow.
- `demo-thread` — a thesis-topic consultation thread used for `mode: "thread"`.

Try it without your own export:

```sh
node bin/reunion.mjs inspect examples/demo-export
node bin/reunion.mjs import examples/demo-export --mode thread \
  --sessions demo-thread --name 论文选题
node bin/reunion.mjs import examples/demo-export --name 小满 \
  --sessions demo-companion
```
