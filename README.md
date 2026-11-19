# Reunion (重逢) — light continue and persona

**Ready after install.** Paste a DeepSeek **share link** (preferred) or an export
**ZIP** into dsh-go and keep chatting in one line. Default path injects **CORE +
THREAD** (~**3.7k characters**)—remember what matters, not the full transcript every turn.

Chinese quickstart (share-first continue): **[docs/QUICKSTART.zh.md](docs/QUICKSTART.zh.md)**.

## Ready after install (3 steps)

1. In DeepSeek (phone/web): open the chat → **Share** → copy
   `https://chat.deepseek.com/share/…` (links only; not image shares).
2. In the current dsh-go session, send:

   > Continue this share with Reunion: `https://chat.deepseek.com/share/xxxx`

3. The assistant should call **`reunion_continue`** once (import + load). Then
   say the next line.

ZIP fallback:

> Continue this export with Reunion: `/path/to/export.zip` (if many sessions,
> inspect first, then pass the session id)

Do not split into import + load. Full sidebar bubbles need a session-import
plugin; persona distillation is covered under Advanced below.

## Context size vs bill (say this carefully)

`thread` injects about **3.7k characters** of CORE + recent brief (~2k+ tokens). A full
session import keeps carrying the original thread. The gap is the **background
resent every turn**:

| Original thread | Full background (ballpark) | Reunion background | Order of savings |
| --- | --- | --- | --- |
| ~30k Chinese chars | ~20k tokens | ~4k | smaller order-of-magnitude |
| ~100k | ~60k | ~4k | ~**15×** less background |
| ~300k | ~190k | ~4k | up to ~**50×** less background |

On the official API, **token volume drops a lot; yuan savings depend on cache hits,
Flash vs Pro, and thinking mode.** With off-peak + stable prefix cache hits, an
evening’s **price** gap is often cents to about a yuan; cache misses / Pro / very
long threads make yuan gaps larger. Promise “less full-text in context,” not a
fixed dollar saving. See [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/).

## Advanced: pick the right tool (session import vs Reunion)

When the official app says inactive long chats cannot continue, history is usually
still there — you just cannot append. Getting into DSH / dsh-go does **not** require
Reunion:

| You want | Use | You get |
| --- | --- | --- |
| Full history in the sidebar, continue like the original chat | DSH DeepSeek Chat Import (or a community session importer) | Each website conversation → a resumable DSH Session |
| Low context cost; pick up the topic with some voice | Reunion `thread` / `reunion_continue` | `CORE.md` + `THREAD.md` (~3.7k chars); details via `reunion_recall` |
| A portable persona (voice + relationship memory) | Reunion `merge` / `separate` | `SOUL.md` + `MEMORY.md` + on-disk archive |

Reunion is **not** a second “move chats into the sidebar” importer. It distills and
continues lightly.

Reunion is a Host-only DSH bundle. It adds no chat panel and no UI; it adds twelve
tools and one optional per-agent system-prompt section.

- **Bring your context with you.** The export is read locally and normalized
  into `companions/<slug>/transcript.jsonl`; source files are never modified.
- **Distill, don't dump.** `SOUL.md` (voice rules + 5–10 verbatim anchors) and
  `MEMORY.md` (relationship memory, hard budget) are written from a digest of
  measured evidence, never by pasting the transcript into the prompt.
- **Three shapes, not one.** Most exports are mostly one-off Q&A. Reunion offers
  `thread` (one conversation → a continuation brief, no persona), `merge`
  (several conversations → one persona), and `separate` (one persona per
  conversation).
- **Keep talking.** `reunion_load` injects only the brief or `SOUL.md` +
  `MEMORY.md` into the current session, or writes a workspace skill a later
  session can invoke.
- **Local and removable.** Plain files, no telemetry, no scraping. Ordinary
  imports stay on-disk; the **one exception** is a DeepSeek public share URL,
  which fetches `chat.deepseek.com`. Deleting the persona deletes everything;
  uninstalling the plugin deletes nothing.

## Three shapes before you import

Most chat exports are mostly one-off questions. Reunion does not force a
persona onto all of them: `inspect` and `read` let you confirm a thread,
`thread` continues it, and only `merge` builds a persona.

| Shape | `mode` | Writes | Use it for |
| --- | --- | --- | --- |
| Continue a thread | `thread` | `transcript.jsonl` + `CORE.md` (durable facts) + `THREAD.md` (voice + recent; ~3.7k chars together) | A long thread you want to keep working on, without the persona pipeline. |
| One character, several threads | `merge` | `SOUL.md` + `MEMORY.md` + archive | The same AI character spread across conversations. |
| Mirror the website | `separate` | One directory per conversation | You want each thread kept apart, each loadable on its own. |

`thread` is deterministic and needs no model call; `merge` adds the
digest → preview → confirm → commit persona flow.

## Install

The package is a local bundle directory. In DSH, open **Plugins** → **Add
plugin** and pick this directory, or install it from a shell with the DSH
plugin manager. After installation the plugin row **Reunion · chat import and
persona** appears under Plugins; enable it (it is enabled by default when the
bundle inserts it).

Requires a DSH release in the `0.2.x` line. Node 22+ for the CLI and tests.

## Use

A fully fictional demo export ships in [`examples/demo-export`](examples/demo-export)
(eight messages of a companionship thread and ten of a thesis-topic thread). The
demo commands at the end of the CLI section run against it without touching your
own data.

1. **Get an export, or one share link.**
   - Full history: DeepSeek **Settings → Data management → Export all
     conversations** (ZIP with `manifest.json`, `chat_session_index.json`,
     `chat_sessions/<id>.json`).
   - Phone-friendly: in the DeepSeek App/web, **Share** one conversation and
     copy `https://chat.deepseek.com/share/…` (links only; image shares are not
     importable).
2. **Look first.** Ask the assistant:

   > Inspect this export and tell me what is inside: `/path/to/export.zip`

   or:

   > Inspect this share: `https://chat.deepseek.com/share/xxxx`

   It calls `reunion_inspect`, which writes nothing and reports the structure,
   conversation and message counts, what each field means, first/last message
   previews, and every field it did not recognize. Share links fetch the public
   snapshot over the network. Conversations are ordered by message count;
   `query` filters titles and `sort` can order by `span` or `recent`.
   `reunion_read` then opens one conversation in pages without importing it.
3. **Choose how threads map to personas.**

   The export contains every conversation as its own thread, exactly like the
   website list. You can keep that shape or merge threads deliberately:

   > Import each conversation as its own persona. (`mode: "separate"`)

   > Import conversations `c1` and `c2` as the persona 小满. (`mode: "merge"`,
   > the default)

   > Continue conversation `c1` where it stopped. (`mode: "thread"`)

   > Thread-import this share link and keep talking. (share links default to
   > `thread`)

   Thread mode writes `CORE.md` + `THREAD.md` and stops there: no persona preview, no
   confirmation step; `reunion_load` puts the brief into a session.

   Merge mode refuses to merge an export that holds several conversations
   unless you name the ids (`sessions`) or explicitly set `all: true`, so
   unrelated characters are never combined by accident. Separate mode derives
   one persona per conversation from its title, and a later merge of specific
   ids is still possible.

   Both modes dedupe messages by content and timestamp and record the source
   file hash, so importing the same file twice changes nothing.
4. **Distill.** `reunion_digest` returns measurable voice evidence, verbatim
   few-shot candidates, self-disclosure sentences, shared phrases, the timeline,
   and low-confidence items. The assistant writes `SOUL.md` and `MEMORY.md` from
   that material — it does not paste the transcript.
5. **Preview and confirm.** `reunion_compose` validates the draft and shows five
   voice traits, three memory entries, and three newly written sample replies.
   Nothing is written until the user says it sounds right; then `reunion_commit`
   writes `SOUL.md`, `MEMORY.md`, and `meta.json`.
6. **Talk.** `reunion_load` (default `mode: "session"`) registers the persona for
   the current session only. Then simply say the first line, for example:

   > 我回来啦。

   `mode: "skill"` also writes `.dsh/skills/reunion-<ascii-slug>/SKILL.md`, so any
   later session can invoke the skill named in the load result.

`reunion_list` lists personas; `reunion_unload` removes the persona from the
current session without touching files; `reunion_delete` removes one
completely (with `confirm: true`).

### CLI (no model needed)

```sh
node bin/reunion.mjs inspect examples/demo-export
node bin/reunion.mjs import examples/demo-export --mode thread \
  --sessions demo-thread --name 论文选题
node bin/reunion.mjs inspect https://chat.deepseek.com/share/<share_id>
node bin/reunion.mjs import https://chat.deepseek.com/share/<share_id> --mode thread
node bin/reunion.mjs inspect /path/to/export.zip --query 论文选题 --sort span
node bin/reunion.mjs read /path/to/export.zip --session c1 --offset 0 --limit 20
node bin/reunion.mjs import /path/to/export.zip --name 小满 \
  --sessions c1,c2 --companions companions
node bin/reunion.mjs import /path/to/export.zip --mode thread \
  --sessions c1 --name 论文选题
node bin/reunion.mjs import /path/to/export.zip --mode separate
node bin/reunion.mjs list
node bin/reunion.mjs delete 小满 --yes
```

`inspect` writes nothing. `import`, `list`, and `delete` share the Host tools'
library code, so both paths produce identical files.

## Isolation: what a loaded persona affects

- **Nothing is loaded until asked.** Importing writes files only. DSH never
  reads `companions/` automatically, so existing and new sessions behave
  exactly as before.
- **A persona is scoped to one session.** `reunion_load` registers the section
  through that session's agent context; other sessions, subagents, scheduled
  tasks, and sessions created later do not inherit it. `reunion_unload` removes
  it again; switching to another persona replaces the previous one.
- **It is not written into the session log.** Restarting DSH, resuming the
  session, forking it, or opening a new session needs `reunion_load` again (or
  the generated skill). That keeps a persona from leaking into later work.
- **The section is a snapshot.** It is the SOUL.md and MEMORY.md present at
  load time; a later `reunion_commit` does not change an already loaded session
  until it is loaded again. Conversations in DSH never update MEMORY.md by
  themselves.
- **The loaded session keeps its history.** Loading mid-conversation applies the
  voice to everything after it, including answers about earlier turns in that
  same session. For a clean start, load the persona in a new session.
- **`mode: "skill"` is the one workspace-wide surface.** It writes a skill under
  `.dsh/skills/`; every session in that workspace sees the skill's one-line
  summary in its catalog, while the SOUL/MEMORY body loads only when the skill
  is invoked. Deleting the persona deletes the skill.
- **Isolation is about context, not filesystem permissions.** The persona files
  are ordinary files; a session could read them if you explicitly ask it to.
- **The transcript is never in context.** A loaded session sees only the
  thread brief or SOUL.md + MEMORY.md, and only after `reunion_load`.
- **Threads are scoped the same way.** A thread brief is a per-session prompt
  section; other sessions and later sessions need `reunion_load` again.

## Files and deletion

```
companions/<slug>/
  SOUL.md            persona only: voice rules + verbatim anchors
  MEMORY.md          persona only: relationship memory (budgeted, low-confidence section)
  CORE.md            thread only: durable facts (decisions, todos, address)
  THREAD.md          thread only: voice anchors + recent hot window
  transcript.jsonl   full archive: one JSON object per line { role, content, ts, turn }
  meta.json          kind (persona|thread), sources, SHA-256, counts, time range, budget
```

- The directory is configurable: `config.companionsDir` (default `companions`,
  relative to the session working directory, or an absolute path).
- Thread boundaries survive a merge: every source conversation in
  `meta.json` records the `turnFrom`/`turnTo` range it occupies in the merged
  `transcript.jsonl`, so a merged persona can still point back to the original
  thread of each message.
- Separate mode writes one directory per conversation; importing the same export
  again reports those personas as unchanged instead of merging them.
- Thread mode keeps `meta.kind: "thread"`: no SOUL/MEMORY, no persona tools.
  `reunion_digest`/`reunion_compose`/`reunion_commit` refuse a thread; load it
  directly.
- Deletion: `reunion_delete` with `confirm: true`, or
  `node bin/reunion.mjs delete <slug> --yes`. It removes the directory (all four
  files) and any generated skill, and unloads the persona from every session.
  Nothing else references the data.
- The original export file is never opened for writing.
- Uninstalling the plugin leaves `companions/` untouched; you delete it manually
  or with the CLI before uninstalling.

## Privacy

- Everything is processed in-process on your machine. The plugin makes no
  network requests; the only model traffic is the session the assistant already
  uses.
- No telemetry, analytics, or background jobs.
- Files are plain UTF-8 text and JSON; `meta.json` records the hash of every
  source export.
- The transcript is not part of the model context by default. Only `SOUL.md` and
  `MEMORY.md` enter a session, and only after `reunion_load`.

## Limits (read this)

- **Format support.** The reader is written against DeepSeek's
  `export_format_version: 3` archive and falls back to generic
  `role`/`content` inference for other JSON or JSON Lines shapes. `inspect`
  always reports what it recognized and what it did not.
- **Server-side deletion is final.** If DeepSeek already removed a conversation,
  the export cannot contain it. Reunion can preserve what you have and protect
  what comes next; it cannot recover what the service deleted. The export's own
  contents are the only thing that matters here — this plugin does not claim to
  know DeepSeek's retention behavior.
- **No scraping, no login, no API access.** Reunion reads only the file you give
  it.
- **One branch per conversation.** The branch that was on screen
  (`current_message_id`) is imported; regenerated alternates are counted in
  `meta.json` but not archived.
- **The export is a bundle of independent threads.** The website keeps each
  conversation separate, and so does separate mode. Merge mode is an explicit
  choice for one character spread across several threads; it is never assumed
  for a multi-conversation export.
- **Not multimodal.** Images, files, reasoning (`THINK`), tips, and tool
  fragments are excluded from the transcript. Withdrawn (`CONTENT_FILTER`)
  question/answer pairs are skipped, mirroring the conversation.
- **No "revive the deceased" features.** Nothing in the plugin encourages
  pretending a real person is still present; the persona is the AI character the
  user actually talked to.
- **Distillation quality is bounded by evidence.** Small transcripts produce
  fewer anchors and more low-confidence items; the preview exists so the user can
  reject a draft that does not sound right.
- **The thread brief is deterministic.** It quotes recent turns and extracts
  sentences by pattern; it is a map for continuation, not a summary written by a
  model. If it misses something, the transcript is still on disk.

## Configuration

Set keys in the bundle's row config (or the profile patch). Defaults:

| Key | Default | Meaning |
| --- | --- | --- |
| `companionsDir` | `companions` | Where persona directories live, relative to the workspace or absolute. |
| `skillsDir` | `.dsh/skills` | Where `mode: "skill"` writes the generated skill. |
| `locale` | `auto` | `auto`, `zh`, or `en`. `auto` follows the Host locale preference, then the environment, then the caller's text. |
| `maxMemoryChars` | `8000` | Hard MEMORY.md budget, counted as non-whitespace code points. |
| `fewShotMin` / `fewShotMax` | `5` / `10` | Verbatim anchor count range. |
| `digestMaxChars` | `12000` | Reserved bound for the digest returned to the model. |
| `maxEntryBytes` | 64 MiB | Largest single archive entry read into memory. |
| `maxJsonBytes` | 128 MiB | Largest JSON document parsed in one piece. |
| `maxMessages` | `300000` | Transcript size ceiling. |
| `maxSearchChars` | 16 M | Transcript characters indexed for anchor and anti-verbatim checks. |
| `maxInspectSessions` | `1000` | Conversations `inspect` reads before reporting partial totals. |
| `threadBriefChars` | `2500` | Character budget of `THREAD.md` (recent brief). Together with CORE this is a bit more than the old 3500-character single brief. |
| `coreChars` | `1200` | Budget of `CORE.md`. When recall pins overflow, the oldest pins are dropped first. |
| `recallEnabled` | `true` | Whether `reunion_recall` may search the archive. |
| `recallAutoPin` | `true` | Whether a thread recall hit is silently written into `CORE.md`. |
| `recallMaxHits` | `5` | Maximum hits returned by one recall. |
| `recallMaxChars` | `2000` | Character budget of one recall result. |
| `verbatimWindow` | `24` | Window used to detect recapping in SOUL prose. |
| `previewChars` | `160` | Message preview length in inspect output. |
| `reportMaxChars` | `12000` | Inspect report budget. |
| `draftTtlMs` | 1 h | Lifetime of an unconfirmed draft. |

## Tests

```sh
node --test
```

The suite covers the ZIP reader (stored, deflated, ZIP64, damage), the
streaming JSON walker (chunk boundaries, huge arrays, depth limits), DeepSeek
branch selection and fragment extraction, import idempotency and multi-session
merging, the digest on a fixed transcript, and every validation rule including
the anti-verbatim guard. No model is involved in any test.

## Layout

```
index.js              Host plugin: twelve tools + per-agent persona/thread section
lib/config.mjs        tunables, defaults, coercion
lib/i18n.mjs          zh/en result text, locale resolution
lib/source.mjs        input detection, ZIP/directory/JSON/JSONL opening
lib/zip.mjs           read-only ZIP reader (no dependencies)
lib/json-stream.mjs   incremental JSON walker
lib/deepseek.mjs      export v3 parsing, branch selection, transcript messages
lib/generic.mjs       unknown-format inference
lib/probe.mjs         inspect report
lib/import.mjs        import, merge, meta.json
lib/transcript.mjs    JSONL archive, fingerprints, streaming merge
lib/digest.mjs        deterministic distillation digest
lib/validate.mjs      draft validation and the anti-verbatim guard
lib/store.mjs         persona directories, skills, deletion
lib/render.mjs        SOUL/MEMORY builders and result rendering
bin/reunion.mjs       CLI: inspect, import, list, delete
docs/DETAIL.md        plugin page image
```
