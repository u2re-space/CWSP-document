# AGENTS.md

## Pantry — persistent project notes

This project uses persistent notes via the `pantry` MCP tools.

### Required at session start

Before doing any substantive work, load existing context from previous sessions:

1. Call `pantry_context` to retrieve recent project notes.
2. If the task is about a specific feature, bug, subsystem, file, or topic, also call `pantry_search` with relevant keywords.

Do not skip this step. Important context may exist only in Pantry and may not be visible in the repository.

### Required at session end

If the session produced any durable outcome, store it in Pantry before finishing. This includes:

- code changes
- architectural or implementation decisions
- bug investigations or root causes
- useful discoveries
- non-obvious project context that would help a future agent

Use `pantry_store` with:

- `title`: short descriptive title
- `what`: what happened or what was decided
- `why`: the reasoning behind it
- `impact`: what changed or what is affected
- `category`: one of `decision`, `pattern`, `bug`, `context`, `learning`
- `details`: enough detail for a future agent with no prior context

Do not skip this step for tasks that involved changes, decisions, bugs, or learnings. Pantry is the project’s long-term memory across sessions.

---

## Token usage optimization

Keep context usage efficient:

- Prefer **Grep / ripgrep** when locating functions, classes, variables, or symbols instead of opening large files.
- Read only the relevant file ranges when a file is large.
- Do not proactively load generated or vendor output into context, such as:
  - `build/`
  - `.gradle/`
  - minified bundles
  - other generated artifacts
- Be concise in both internal reasoning and user-facing responses.

---

## Cursor Cloud instructions

### Project summary

This repository is **CWS (CrossWord Sync)**, a Kotlin / Jetpack Compose Android application.

Key facts:

- The **Kotlin package / manifest namespace** must remain `space.u2re.cws`.
- The **`applicationId`** depends on the selected product flavor (see below).
- The app supports multi-device synchronization, clipboard sharing, encrypted communication, and command forwarding.

### Environment prerequisites

The Cloud VM expects the following setup:

- **JDK 21** at `/usr/lib/jvm/java-21-openjdk-amd64`
  - `JAVA_HOME` must be set
- **Android SDK** at `/opt/android-sdk`
  - Required components:
    - `platforms;android-36`
    - `build-tools;36.0.0`
    - `platform-tools`
- A `local.properties` file must exist in the project root with:

  `sdk.dir=/opt/android-sdk`

This file is gitignored.

### Common commands (Android)

| Task | Command |
|---|---|
| Assemble debug (**default hybrid** `space.u2re.cwsp` — CWSP + embedded WebView) | `./gradlew :app:assembleCwspDebug` or `npm run build` |
| Assemble debug (standalone `space.u2re.cws` — Kotlin-only) | `./gradlew :app:assembleCwsDebug` or `npm run assemble:cws` |
| Lint (`cws` debug) | `./gradlew :app:lintCwsDebug` |
| Unit tests | `./gradlew :app:testCwsDebugUnitTest` or `./gradlew :app:testCwspDebugUnitTest` |
| Full build (compile + test + lint) | `./gradlew build` |

All Gradle commands require both `JAVA_HOME` and `ANDROID_HOME` to be set.

### npm command defaults

These commands default to the **`cwsp` hybrid flavor** (`space.u2re.cwsp`):

- `npm run dev`
- `npm run assemble`
- `npm run build`

Use these commands for the Kotlin-only standalone flavor **`cws`** (`space.u2re.cws`):

- `npm run dev:cws`
- `npm run assemble:cws`

### Product flavors

| Flavor | `applicationId` | Purpose |
|---|---|---|
| `cwsp` | `space.u2re.cwsp` | **Default hybrid flavor**: embedded CWSP WebView + Kotlin. Matches `runtime/cwsp/capacitor.config.ts`. See Settings → Open web shell. |
| `cws` | `space.u2re.cws` | Kotlin / Compose-first standalone flavor. Use with `-PcwsAdbFlavor=cws` for `attachDebug`, or use `npm run dev:cws`. |

`attachDebug` uses **`cwsp`** by default.  
To target the Kotlin-only package, pass:

`-PcwsAdbFlavor=cws`

---

## CWSP Capacitor integration

The app includes **Capacitor** (`@capacitor/android` from the monorepo at `runtime/cwsp`) as a second UI shell alongside Compose.

### How it is wired

- **Gradle module inclusion**
  - Gradle includes `:capacitor-android` from the nearest ancestor directory containing:
    `runtime/cwsp/node_modules/@capacitor/android/capacitor`
  - You can override this path with `CWS_CAPACITOR_ANDROID_DIR`.

- **Repositories**
  - `dependencyResolutionManagement` uses `PREFER_SETTINGS`.
  - This avoids build failures caused by the Capacitor library declaring its own `repositories {}` block, which would otherwise conflict with `FAIL_ON_PROJECT_REPOS`.

- **Shared Gradle properties**
  - Root-level `extra` properties in `build.gradle.kts` mirror `runtime/cwsp/android/variables.gradle`.
  - This ensures the Capacitor library sees the same SDK and AndroidX versions as the standalone Capacitor Android project.

- **Web asset sync**
  - `preBuild` runs `syncCwspCapacitorWeb`.
  - This copies:

    `runtime/cwsp/dist/capacitor` → `app/src/main/assets/public`

    when that source directory exists.

  - To generate those assets, run one of:
    - `npm run build:capacitor:web`
    - `npm run build:capacitor`
    - `node scripts/build-cws-android.mjs --with-capacitor-web` from the CWSP side

- **UI entry point**
  - In the app UI: **Settings → General → Open web shell**
  - This launches `CapacitorWebActivity` (`BridgeActivity`)

---

## Known gotchas

- **No physical device or emulator is available in the Cloud VM.**
  - You can build, lint, and inspect outputs.
  - You cannot install or run the app on-device in this environment.

- The `endpoint` and `airpad` symlinks in the repo root are **broken**.
  - They point to a sibling repo: `../U2RE.space/`
  - That repo is not present in this workspace.
  - These symlinks are **not required for building**.

- The unit test task may report `NO-SOURCE`.
  - This is expected because the project currently has no unit test files.

- Gradle may auto-download missing SDK components during the first build
  (for example `build-tools;35`).
  - This is normal.

- The `audioswitch-stub` module is a stub replacement for a Twilio dependency.
  - It contains no Kotlin sources.

---

## Additional code locations

When the task is relevant, also inspect these paths:

- `/home/u2re-dev/U2RE.space/modules/projects/uniform.ts/src/newer/` — internal
- `/home/u2re-dev/U2RE.space/runtime/cwsp/endpoint/` — network-related

---

## Model selection

- **Analysis / architecture / planning:** Claude Opus 4.6, GPT 5.4 (`high` or `xhigh`), Gemini 3.1 Pro
- **Coding / implementation / refactoring:** GPT-5.4 (`low` or `medium`), Claude 4.6 Sonnet, Gemini 3.1 Pro
- **Edits / fixes / refinements:** `GPT-5.3-codex-spark`, GPT-5.4 (`instant`, `none`, or `minimal` reasoning), Claude 4.5 Haiku, Gemini 3 Flash
- **Documentation / specs:** GPT-5.4 (`low` or `medium`), Claude 4.6 Sonnet, Gemini 3.1 Pro
- **Recognition / scanning / images:** GPT-5.4 (`low`, `instant`, `none`, or `minimal`), Claude 4.6 Sonnet, Gemini 3.1 Pro, or Gemini 3 Flash

---

## SSH access

Available SSH targets include:

- `ssh U2RE@192.168.0.110`
- `ssh U2RE@192.168.0.111`
- `ssh u2re-dev@192.168.0.200`
- `ssh u2re-dev@192.168.0.201`
- External access / VDS example:
  - `ssh u2re-dev@45.147.121.152`
  - `ssh root@45.150.9.153 -p 22 -i ~/.ssh/id_ecdsa`
