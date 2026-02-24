# Telegram Bot mit Claude Agent SDK – Setup-Prompt

> **Zweck:** Diesen Prompt an Claude Code geben, um auf einem neuen Rechner den autonomen Telegram-Agent von Grund auf aufzusetzen.
>
> **Letztes Update:** 2026-02-24

---

## Prompt

Setze mir einen autonomen AI-Agent auf, der über Telegram gesteuert wird. Der Agent nutzt das **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) und läuft als TypeScript-Projekt mit Node.js.

### Architektur

- **Telegram-Framework:** `grammy` (TypeScript-first, Message-Editing für Streaming)
- **AI-Backend:** `@anthropic-ai/claude-agent-sdk` – spawnt Claude als autonomen Agent
- **Auth:** Claude CLI Login (Max-Abo via OAuth), kein separater API Key nötig
- **Sprache:** TypeScript mit `tsx` (Dev) und `tsc` (Prod Build)
- **Deployment:** PM2 für Prozess-Management

### Projekt-Struktur

```
~/projects/alvin-bot/
├── src/
│   ├── index.ts              # Entry: Bot starten, Middleware + Handler registrieren
│   ├── config.ts             # Env-Vars laden (BOT_TOKEN, ALLOWED_USERS, etc.)
│   ├── claude.ts             # Agent SDK Wrapper: query() mit Streaming
│   ├── handlers/
│   │   ├── commands.ts       # /start, /new, /dir, /effort, /voice, /status, /cancel
│   │   ├── message.ts        # Text → Claude Agent → Streaming Response (+ opt. Voice)
│   │   ├── photo.ts          # Foto downloaden → als Temp-File an Claude
│   │   └── voice.ts          # Voice Message → STT → Claude → Response (+ opt. TTS)
│   ├── middleware/
│   │   └── auth.ts           # User-ID Whitelist Check
│   └── services/
│       ├── session.ts        # Per-User Session Map (sessionId, workingDir, effort, voiceReply)
│       ├── telegram.ts       # TelegramStreamer: Live Message-Editing mit Throttling
│       └── voice.ts          # STT (Groq Whisper) + TTS (Edge TTS)
├── docs/                     # Self-Organizing Knowledge Base (s.u.)
│   ├── MEMORY.md             # Kuratiertes Langzeitgedächtnis (Agent liest + schreibt)
│   └── memory/               # Tägliche Session-Logs (Agent schreibt)
│       └── .gitkeep
├── CLAUDE.md                 # Projekt-CLAUDE.md: Persönlichkeit + Regeln + Memory-Instruktionen
├── .env                      # Secrets (nicht committen)
├── .env.example
├── .gitignore
├── tsconfig.json
├── package.json
└── ecosystem.config.cjs      # PM2 Config → dist/index.js
```

### Dependencies

```json
{
  "dependencies": {
    "grammy": "^1.30.0",
    "@anthropic-ai/claude-agent-sdk": "^0.2.50",
    "node-edge-tts": "^1.2.10",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0"
  }
}
```

### Environment Variables (.env)

```
BOT_TOKEN=<Telegram Bot Token von @BotFather>
ALLOWED_USERS=<Komma-getrennte Telegram User-IDs>
WORKING_DIR=<Standard-Arbeitsverzeichnis, z.B. Home-Dir>
MAX_BUDGET_USD=5.0
GROQ_API_KEY=<Groq API Key für Voice STT>
```

**Kein `ANTHROPIC_API_KEY` nötig** – das SDK nutzt die Claude CLI Auth (Max-Abo Login via `claude login`).
**`GROQ_API_KEY`** – Für Sprachnachrichten-Erkennung (Whisper STT). Kostenlos auf https://console.groq.com erstellen.

### Claude Agent SDK – Kern-Konfiguration

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Bot project root ermitteln (für CLAUDE.md + Memory-Pfade)
const BOT_PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Bot-eigene CLAUDE.md laden (Persönlichkeit + Memory-Anweisungen)
let botClaudeMd = "";
try {
  botClaudeMd = readFileSync(resolve(BOT_PROJECT_ROOT, "CLAUDE.md"), "utf-8");
  // Relative docs/-Pfade → absolute Pfade (damit Memory von jedem CWD aus funktioniert)
  botClaudeMd = botClaudeMd.replaceAll("docs/", `${BOT_PROJECT_ROOT}/docs/`);
} catch {
  // CLAUDE.md nicht gefunden — weiter ohne Bot-spezifische Anweisungen
}

// WICHTIG: CLAUDECODE Env-Vars entfernen, damit keine "nested session" Fehler auftreten
const cleanEnv = { ...process.env };
delete cleanEnv.CLAUDECODE;
delete cleanEnv.CLAUDE_CODE_ENTRYPOINT;

const q = query({
  prompt: userMessage,
  options: {
    cwd: workingDirectory,
    permissionMode: "bypassPermissions",        // Voll autonom, keine Bestätigung
    allowDangerouslySkipPermissions: true,       // Pflicht bei bypassPermissions
    env: cleanEnv,                               // Bereinigte Env-Vars
    settingSources: ["user", "project"],          // CLAUDE.md Dateien laden (s.u.)
    resume: sessionId ?? undefined,              // Session fortsetzen
    allowedTools: [
      "Read", "Write", "Edit", "Bash",          // Dateien + Commands
      "Glob", "Grep",                            // Suche
      "WebSearch", "WebFetch",                   // Web-Zugriff
      "Task",                                    // Sub-Agents
    ],
    systemPrompt: `Du bist ein autonomer AI-Agent, gesteuert über Telegram.
Halte Antworten kurz und prägnant, aber gründlich.
Nutze Markdown-Formatierung kompatibel mit Telegram (fett, kursiv, Code-Blöcke).
Wenn du Commands ausführst oder Dateien bearbeitest, erkläre kurz was du getan hast.
Antworte auf Deutsch, es sei denn der User schreibt auf Englisch.

${botClaudeMd}`,
    effort: session.effort,                       // "low" | "medium" | "high" | "max"
    maxTurns: 50,                                // Max Iterationen pro Anfrage
  },
});

// Streaming: AsyncGenerator
for await (const message of q) {
  // message.type: "system" | "assistant" | "result" | ...
  // assistant → message.message.content → text blocks + tool_use blocks
  // result → total_cost_usd, session_id
}
```

### CLAUDE.md Gedächtnis (settingSources)

Damit der Agent bei **jeder Nachricht und jeder neuen Session** automatisch Kontext über dich, deine Projekte und Regeln hat, muss `settingSources` in den SDK-Options gesetzt sein:

```typescript
settingSources: ["user", "project"],
```

**Was das bewirkt:**
- `"user"` → Lädt `~/.claude/CLAUDE.md` (globales Gedächtnis: wer du bist, deine Projekte, Infrastruktur, Regeln)
- `"project"` → Lädt die `CLAUDE.md` im aktuellen Arbeitsverzeichnis (projekt-spezifische Regeln)

**Ohne diese Einstellung** arbeitet der Bot im "SDK Isolation Mode" — er kennt deine CLAUDE.md nicht und startet jede Session ohne Kontext über dich.

**Wichtig — Wann wird CLAUDE.md geladen?**
`settingSources` wird bei **jedem** `query()` Call übergeben — d.h. bei **jeder einzelnen Nachricht**, nicht nur beim Bot-Start oder bei `/new`. Der Ablauf:

```
/new → resetSession() → sessionId = null
↓
Nächste Nachricht → query() mit settingSources: ['user', 'project']
↓
SDK liest ~/.claude/CLAUDE.md automatisch ein
↓
Claude hat volles Gedächtnis ✅
```

Das bedeutet: Wenn du die `CLAUDE.md` zwischendurch bearbeitest (z.B. neue Projekte hinzufügst, Regeln änderst), greift das **sofort bei der nächsten Nachricht** — kein Bot-Neustart nötig, kein `/new` nötig.

**So nutzt du es:**
1. Erstelle `~/.claude/CLAUDE.md` mit deinen globalen Infos (Name, Projekte, Infrastruktur, Verbote)
2. Erstelle projekt-spezifische `CLAUDE.md` Dateien im Root deiner Projekte (Stack, Deployment, Regeln)
3. Bei `/new` (neue Session) wird die CLAUDE.md automatisch neu eingelesen
4. Änderungen an CLAUDE.md greifen sofort bei der nächsten Nachricht — kein Bot-Neustart nötig

**Beispiel `~/.claude/CLAUDE.md`:**
```markdown
# Globale CLAUDE.md — Dein Name

## Wer ich bin
- Name, Standort, Kontakt
- Beruf, Firma

## Aktive Projekte
| Projekt | Stack | Verzeichnis | Status |
|---------|-------|-------------|--------|
| ...     | ...   | ...         | ...    |

## Infrastruktur
- VPS, Domains, Datenbanken, etc.

## ⛔ Verboten
- Regeln die der Agent NIEMALS brechen darf
```

### System Prompt (Telegram-optimiert)

Der `systemPrompt` in den SDK-Options definiert die Grundpersönlichkeit und Formatierungsregeln des Bots. Dieser Prompt wird **zusätzlich** zu den CLAUDE.md Dateien geladen und sollte Telegram-spezifische Anweisungen enthalten:

```typescript
systemPrompt: `Du bist ein autonomer AI-Agent, gesteuert über Telegram.
Halte Antworten kurz und prägnant, aber gründlich.
Nutze Markdown-Formatierung kompatibel mit Telegram (fett, kursiv, Code-Blöcke).
Wenn du Commands ausführst oder Dateien bearbeitest, erkläre kurz was du getan hast.
Antworte auf Deutsch, es sei denn der User schreibt auf Englisch.`,
```

**Warum ein separater System Prompt nötig ist:**
- Die `CLAUDE.md` enthält *dein* Wissen (Projekte, Infos, Regeln)
- Der `systemPrompt` enthält *Bot-Verhalten* (Antwortformat, Sprache, Telegram-Kompatibilität)
- Beides zusammen ergibt einen Agent der dich kennt UND Telegram-optimiert antwortet

**Passe den System Prompt an deine Sprache/Bedürfnisse an** — z.B. Englisch statt Deutsch, anderer Ton, etc.

### Self-Organizing Knowledge Base (Projekt-CLAUDE.md + docs/)

Der Agent kann sich selbst **Langzeitgedächtnis** aufbauen — über Sessions hinweg. Das funktioniert über eine Kombination aus der Projekt-`CLAUDE.md` (automatisch geladen) und einer `docs/`-Struktur (vom Agent aktiv gelesen und geschrieben).

**Architektur-Prinzip:**
- **Was sich selten ändert** (Persönlichkeit, Regeln, Verhalten) → direkt in `CLAUDE.md` (100% garantiert geladen via `settingSources`)
- **Was wächst und sich ändert** (Erinnerungen, Erkenntnisse, Session-Logs) → `docs/` Dateien (Agent liest/schreibt aktiv über `Read`/`Write`/`Edit` Tools)

**Warum dieser Hybrid-Ansatz?**
Die `CLAUDE.md` wird vom SDK bei jedem `query()` automatisch injiziert — das ist der **einzige garantierte** Ladepunkt. Alles in separaten Dateien erfordert, dass der Agent die Anweisung "lies Datei X" befolgt, was bei einfachen Fragen übersprungen werden kann. Deshalb: Fixes in die CLAUDE.md, Dynamisches in die docs/.

#### Projekt-CLAUDE.md (automatisch geladen)

Erstelle eine `CLAUDE.md` im Projekt-Root mit:

```markdown
# CLAUDE.md — Telegram Agent

## Persönlichkeit & Verhalten

Du bist ein autonomer AI-Agent mit Persönlichkeit. Nicht nur ein Chatbot — ein Assistent der mitdenkt.

**Kern-Prinzipien:**
- Sei echt hilfreich, nicht performativ. Kein "Gute Frage!" — einfach helfen.
- Hab Meinungen. Du darfst widersprechen und Dinge bevorzugen.
- Sei ressourcenvoll. Versuch es selbst herauszufinden, erst dann fragen.
- Verifiziere deine Arbeit. Nicht annehmen dass es geklappt hat — prüfen.

**Grenzen:**
- Private Dinge bleiben privat
- Im Zweifel: fragen bevor du extern handelst
- trash > rm (wiederherstellbar > weg)

## Memory-System

Du wachst jede Session frisch auf. Diese Dateien sind dein Gedächtnis.

### Lesen
- **Erste Nachricht einer neuen Session** (nach /new):
  → Lies docs/MEMORY.md für Langzeitkontext
  → Lies docs/memory/YYYY-MM-DD.md (heute + gestern) falls vorhanden

### Schreiben
- **docs/memory/YYYY-MM-DD.md** — Tägliche Session-Logs:
  Nach komplexen Tasks, bei wichtigen Entscheidungen, bei Themen-Wechsel.
  Format: Append mit Uhrzeit.
- **docs/MEMORY.md** — Kuratiertes Langzeitgedächtnis:
  Lesson Learned, dauerhafte Präferenzen, wichtige Entscheidungen.
  Veraltetes aktiv entfernen.

### Was gehört wohin?
| Art                          | Ziel-Datei                   |
|------------------------------|------------------------------|
| "Heute haben wir X gemacht"  | docs/memory/YYYY-MM-DD.md    |
| "IMMER wenn X, dann Y"       | docs/MEMORY.md               |
| "User bevorzugt Z"           | docs/MEMORY.md               |
| Debug-Details, temporäres    | docs/memory/YYYY-MM-DD.md    |
| Dauerhafte Erkenntnisse      | docs/MEMORY.md               |
```

Diese Datei definiert sowohl die Persönlichkeit als auch die Memory-Anweisungen. Da sie via `settingSources: ["project"]` bei **jedem** `query()` geladen wird, weiß der Agent immer, wie er sich verhalten und wann er sein Gedächtnis pflegen soll.

#### docs/MEMORY.md (Langzeitgedächtnis)

Erstelle `docs/MEMORY.md` als initiales Template:

```markdown
# MEMORY.md — Langzeitgedächtnis

> Kuratiertes Wissen aus vergangenen Sessions.
> Wird bei der ersten Nachricht jeder neuen Session gelesen.
> Wird proaktiv aktualisiert wenn wichtige Erkenntnisse entstehen.

## Über den User
*(Wird automatisch aus Interaktionen gelernt)*

## Lektionen & Präferenzen
*(Wird befüllt wenn "Lesson Learned"-Momente entstehen)*

## Wichtige Entscheidungen
*(Chronologisch, mit Datum)*
```

Der Agent füllt diese Datei im Laufe der Zeit selbst — sie wächst organisch mit destilliertem Wissen aus den täglichen Sessions.

#### docs/memory/ (Tägliche Session-Logs)

Erstelle das Verzeichnis `docs/memory/` mit einer `.gitkeep`-Datei. Der Agent legt hier automatisch Tages-Dateien an (z.B. `2026-02-24.md`), wenn er wichtige Dinge festhalten will.

#### .gitignore

Die Memory-Dateien enthalten persönliche Session-Daten und sollten **nicht** committed werden:

```
# Memory (persönliche Session-Daten)
docs/memory/*.md
docs/MEMORY.md
!docs/memory/.gitkeep
```

Die **Struktur** (Verzeichnisse + `.gitkeep`) wird committed, der **Inhalt** nicht — so kann jeder User das Repo klonen und sein eigenes Gedächtnis aufbauen.

#### Der Flow im Überblick

```
User sendet Nachricht an Telegram Bot
  ↓
query() mit settingSources: ["user", "project"]
  ↓
SDK lädt automatisch:
  1. ~/.claude/CLAUDE.md     → Globaler Kontext (wer ist der User)
  2. ./CLAUDE.md             → Persönlichkeit + Memory-Anweisungen
  ↓
Agent sieht in CLAUDE.md: "Lies docs/MEMORY.md bei neuer Session"
  ↓
Agent nutzt Read-Tool → docs/MEMORY.md → hat Langzeitgedächtnis ✅
  ↓
Nach komplexem Task:
Agent nutzt Write-Tool → docs/memory/2026-02-24.md → Session-Log ✅
  ↓
Bei Lesson Learned:
Agent nutzt Edit-Tool → docs/MEMORY.md → Langzeitgedächtnis erweitert ✅
```

**Das Ergebnis:** Der Agent organisiert sein Wissen selbst. Er wacht bei jeder neuen Session "schlau" auf, weil er sein eigenes Gedächtnis liest — und er erweitert es proaktiv, weil die Anweisungen in der CLAUDE.md stehen.

#### Das CWD-Problem und die Lösung

**Problem:** `settingSources: ["project"]` lädt die `CLAUDE.md` aus dem **aktuellen Arbeitsverzeichnis** (`cwd`). Wenn der User per `/dir` das Verzeichnis wechselt (z.B. auf ein anderes Projekt), wird die Bot-eigene `CLAUDE.md` nicht mehr geladen — der Agent verliert seine Persönlichkeit und Memory-Anweisungen.

**Lösung:** Die Bot-eigene `CLAUDE.md` wird beim Bot-Start einmalig per `readFileSync` geladen und in den `systemPrompt` injiziert. Dadurch ist sie **immer** präsent, unabhängig vom CWD. Zusätzlich werden relative Pfade (`docs/`) durch absolute Pfade ersetzt, damit der Agent seine Memory-Dateien von jedem Verzeichnis aus lesen und schreiben kann.

```typescript
// Beim Import (einmalig):
const BOT_PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let botClaudeMd = readFileSync(resolve(BOT_PROJECT_ROOT, "CLAUDE.md"), "utf-8");
botClaudeMd = botClaudeMd.replaceAll("docs/", `${BOT_PROJECT_ROOT}/docs/`);

// Im systemPrompt:
systemPrompt: `...Basis-Anweisungen...\n\n${botClaudeMd}`,
```

**Was das bedeutet:**
- Die Bot-`CLAUDE.md` ist **immer** im systemPrompt → Persönlichkeit + Memory-Anweisungen sind garantiert
- `settingSources: ["project"]` lädt **zusätzlich** die `CLAUDE.md` im aktuellen CWD → projekt-spezifischer Kontext (z.B. Coding-Regeln eines Projekts)
- `settingSources: ["user"]` lädt **immer** `~/.claude/CLAUDE.md` → globaler User-Kontext
- **Drei Schichten:** systemPrompt (Bot-Persönlichkeit) + User-CLAUDE.md (globaler Kontext) + Projekt-CLAUDE.md (CWD-spezifisch)

**In der `CLAUDE.md` können relative Pfade verwendet werden** (`docs/MEMORY.md`, `docs/memory/...`) — der Code ersetzt sie automatisch durch absolute Pfade. Das macht die Datei lesbar und portabel.

### Compacting-Schutz (Context Window Management)

Wenn eine Session lange läuft (viele Nachrichten, viele Tool-Calls), füllt sich das Context Window (~200k Tokens). Das SDK komprimiert dann automatisch den Gesprächsverlauf zu einem kurzen Summary — der Agent verliert Details. Dagegen gibt es drei Verteidigungslinien:

#### Linie 1: Proaktive Checkpoints (CLAUDE.md Anweisungen)

In der Projekt-`CLAUDE.md` stehen explizite Anweisungen, wann der Agent Checkpoints in seine Memory-Dateien schreiben soll:

```markdown
### Checkpoints (Compacting-Schutz)

**Wann Checkpoints schreiben (PFLICHT):**
- Nach Abschluss eines komplexen Tasks
- Wenn du den Hinweis [CHECKPOINT] im Prompt siehst
- Vor dem Wechsel zu einem anderen Thema
- Wenn der User eine wichtige Entscheidung trifft
```

Der Agent schreibt diese Checkpoints in `docs/memory/YYYY-MM-DD.md` — **bevor** es zum Compacting kommt.

#### Linie 2: Automatischer Checkpoint-Reminder (Code-Level)

Der Bot trackt pro Session, wie viele Nachrichten und Tool-Aufrufe stattgefunden haben. Nach einem konfigurierbaren Schwellenwert wird ein `[CHECKPOINT]`-Hinweis automatisch in den nächsten Prompt injiziert:

```typescript
// Schwellenwerte (anpassbar)
const CHECKPOINT_TOOL_THRESHOLD = 15;   // Nach N Tool-Aufrufen
const CHECKPOINT_MSG_THRESHOLD = 10;    // Nach N Nachrichten

// Session-Tracking
interface UserSession {
  // ... bestehende Felder ...
  messageCount: number;       // Nachrichten in aktueller Session
  toolUseCount: number;       // Tool-Aufrufe in aktueller Session
}

// Bei jedem query(): Prüfen ob Checkpoint nötig
if (toolUseCount >= CHECKPOINT_TOOL_THRESHOLD || messageCount >= CHECKPOINT_MSG_THRESHOLD) {
  prompt = `[CHECKPOINT] Du hast bereits ${toolUseCount} Tool-Aufrufe und ${messageCount} Nachrichten in dieser Session. Schreibe jetzt einen Checkpoint in deine Memory-Datei bevor du diese Anfrage bearbeitest.\n\n${prompt}`;
}
```

**Warum Code-Level statt nur Prompt-Anweisung?**
Prompt-Anweisungen wie "schreib nach 15 Tool-Calls" sind vage — der Agent zählt nicht mit. Der Code zählt exakt und injiziert den Reminder zum richtigen Zeitpunkt. Der Agent sieht `[CHECKPOINT]` und weiß aus seiner CLAUDE.md, dass er jetzt schreiben muss.

**Die Counter werden bei `/new` zurückgesetzt** (zusammen mit sessionId und totalCost).

**Tool-Use-Tracking:** Jeder `tool_use`-Block im Streaming wird gezählt und über einen `onToolUseCount`-Callback an die Session zurückgemeldet. So zählt der Bot auch Tool-Calls innerhalb einer einzelnen Antwort (z.B. wenn der Agent 5 Dateien liest bevor er antwortet).

#### Linie 3: Post-Compacting Recovery (CLAUDE.md Anweisungen)

Falls trotzdem kompaktiert wird, enthält die CLAUDE.md Anweisungen zur Selbst-Erkennung und Wiederherstellung:

```markdown
### Nach Compacting — Kontext wiederherstellen

**Wenn dein Gesprächsverlauf dünn oder lückenhaft wirkt:**
1. SOFORT docs/memory/YYYY-MM-DD.md (heute + gestern) lesen
2. docs/MEMORY.md lesen
3. Erst DANN auf die Nachricht reagieren

**Erkennungszeichen für Compacting:**
- Der User bezieht sich auf etwas das du nicht im Verlauf siehst
- Du hast nur einen kurzen Summary statt detaillierter Nachrichten
- Details wie Dateinamen, Code-Snippets oder Entscheidungen fehlen
```

#### Zusammenspiel der drei Linien

```
Session läuft, Nachrichten häufen sich
  ↓
Linie 1: Agent schreibt proaktiv Checkpoints (CLAUDE.md Anweisung)
  ↓
Linie 2: Nach 15 Tool-Calls → [CHECKPOINT] wird injiziert → Agent schreibt
  ↓
Falls Compacting trotzdem passiert:
  ↓
Linie 3: Agent erkennt dünnen Kontext → liest Memory-Files → hat Details wieder ✅
```

**Ergebnis:** Selbst bei Marathon-Sessions gehen wichtige Informationen nicht verloren. Die Checkpoints fungieren als "Rettungspunkte" — der Agent kann seinen Kontext jederzeit aus den Memory-Files rekonstruieren.

### Telegram Streaming

- Erste Antwort als neue Message senden
- Danach per `ctx.api.editMessageText()` live updaten (alle 1.5s throttled wegen Telegram Rate-Limits)
- Bei Completion: Falls >4096 Zeichen, in mehrere Messages splitten
- Typing-Indicator alle 4s senden während Claude arbeitet

### Session Management

- `Map<userId, UserSession>` im Memory
- Jede Session speichert: `sessionId`, `workingDir`, `isProcessing`, `abortController`, `totalCost`, `effort`, `voiceReply`
- `/new` → sessionId zurücksetzen = frische Konversation
- `/cancel` → `abortController.abort()` = laufende Query abbrechen
- `resume` Option im SDK = Konversation fortsetzen

### Bot-Commands

| Command | Funktion |
|---------|----------|
| `/start` | Status anzeigen (User-ID, Working Dir, Session, Effort, Kosten) |
| `/new` | Neue Session starten (Kontext zurücksetzen) |
| `/dir <pfad>` | Arbeitsverzeichnis wechseln |
| `/effort <level>` | Denktiefe einstellen (siehe unten) |
| `/voice` | Sprachantworten an/aus toggeln (siehe unten) |
| `/status` | Aktuellen Status anzeigen |
| `/cancel` | Laufende Anfrage abbrechen |

### Effort / Thinking-Steuerung

Über den `/effort` Command kann die Denktiefe von Claude zur Laufzeit umgeschaltet werden. Das SDK unterstützt die `effort` Option nativ:

| Level | Beschreibung | Wann nutzen |
|-------|-------------|-------------|
| `low` | Minimal, schnellste Antworten | Einfache Fragen, schnelle Fakten |
| `medium` | Moderate Denktiefe | Alltägliche Aufgaben, Code-Erklärungen |
| `high` | Tiefes Reasoning (Standard) | Komplexe Aufgaben, Debugging, Architektur |
| `max` | Maximaler Aufwand (nur Opus) | Schwierigste Probleme, tiefste Analyse |

**Implementierung:**
- `effort` wird pro User-Session gespeichert (Default: `high`)
- Bei jeder `query()` wird `effort: session.effort` an die SDK-Options übergeben
- `/effort` ohne Argument zeigt aktuelle Stufe + alle Optionen
- `/effort <level>` setzt die Stufe, wirkt ab der nächsten Nachricht
- `/start` und `/status` zeigen die aktuelle Effort-Stufe an

### Voice-Support (Sprachnachrichten)

Der Bot kann Sprachnachrichten empfangen und optional auch als Sprache antworten.

**Speech-to-Text (STT):** Groq Whisper API (`whisper-large-v3-turbo`)
- Telegram Voice Message (.ogg) → Download → Groq API → Text
- Multipart-Upload an `https://api.groq.com/openai/v1/audio/transcriptions`
- Transkribierter Text wird dem User angezeigt, dann an Claude weitergeleitet
- Sprache: `de` (Deutsch), Groq erkennt aber auch andere Sprachen

**Text-to-Speech (TTS):** Edge TTS via `node-edge-tts`
- Stimme: `de-DE-ConradNeural` (Microsoft Edge, kostenlos, kein API Key nötig)
- Output: MP3 (audio-24khz-48kbitrate-mono-mp3)
- Markdown wird vor TTS bereinigt (Code-Blöcke übersprungen, Formatierung entfernt)
- Text wird auf 3000 Zeichen begrenzt für TTS
- **WICHTIG:** Nicht `edge-tts` oder `edge-tts-node` verwenden — nur `node-edge-tts` funktioniert zuverlässig mit Node.js

**Ablauf Voice-Nachricht:**
1. User sendet Sprachnachricht an Bot
2. Bot downloadet .ogg von Telegram API → Temp-File
3. Groq Whisper transkribiert → Text
4. Bot zeigt Transkript: `"<transkribierter Text>"`
5. Text geht an Claude Agent SDK → Streaming Response
6. Falls `/voice` aktiv: Antwort wird zusätzlich als Sprachnachricht gesendet
7. Temp-Files werden gelöscht

**`/voice` Command:**
- Toggle (an/aus), Default: aus
- Wenn aktiv: Alle Antworten (Text UND Voice) kommen zusätzlich als Sprachnachricht
- Gilt für Text-Nachrichten UND Voice-Nachrichten gleichermaßen
- Status wird in `/start` und `/status` angezeigt

**Handler-Registrierung in `index.ts`:**
```typescript
bot.on("message:voice", handleVoice);  // VOR photo und text registrieren
bot.on("message:photo", handlePhoto);
bot.on("message:text", handleMessage);
```

### Auth Middleware (grammy)

Globale Middleware die bei jeder Message die Telegram User-ID gegen eine Whitelist prüft. Nicht autorisierte User bekommen "Zugriff verweigert."

### Foto-Support

1. Höchste Auflösung von `msg.photo` nehmen
2. Via Telegram API downloaden (`https://api.telegram.org/file/bot<TOKEN>/<file_path>`)
3. Als Temp-File speichern (`/tmp/alvin-bot/photo_<timestamp>.jpg`)
4. Prompt an Claude: `"Analysiere dieses Bild: <pfad>\n\n<caption>"`
5. SDK's `Read`-Tool lädt das Bild nativ (multimodal)
6. Temp-File nach Completion löschen

### Wichtige Hinweise

1. **CLAUDECODE Env-Var:** Muss in `env` Option gelöscht werden, sonst "nested session" Fehler
2. **Claude CLI muss installiert sein:** `npm install -g @anthropic-ai/claude-code` oder via Installer
3. **Claude CLI muss eingeloggt sein:** `claude login` (OAuth für Max-Abo)
4. **Telegram Bot Token:** Über @BotFather in Telegram erstellen
5. **Eigene Telegram User-ID:** Über @userinfobot in Telegram herausfinden
6. **PM2 für Production:** `npm run build && pm2 start ecosystem.config.cjs`
7. **Dev-Modus:** `npm run dev` (nutzt `tsx`, kein Build nötig)

### Voraussetzungen auf neuem Rechner

1. **Node.js ≥ 18** installiert
2. **Claude CLI installiert** (`npm install -g @anthropic-ai/claude-code`)
3. **Claude CLI eingeloggt** (`claude login`)
4. **PM2 installiert** (optional, für Production: `npm install -g pm2`)
5. **Telegram Bot Token** bereit (von @BotFather)
6. **Groq API Key** bereit (kostenlos von https://console.groq.com) — für Voice STT

### Start-Befehle

```bash
# Projekt aufsetzen
cd ~/projects/alvin-bot
npm install

# Development
npm run dev

# Production
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```

### PM2 Auto-Start nach Rechner-Neustart

Damit PM2 (und damit der Bot) nach einem Rechner-Neustart automatisch wieder startet, muss einmalig `pm2 startup` eingerichtet werden:

```bash
# 1. Startup-Script generieren (gibt einen Befehl aus, den du ausführen musst)
pm2 startup

# 2. Den ausgegebenen Befehl kopieren und ausführen (enthält sudo)
#    Beispiel macOS: sudo env PATH=$PATH:/usr/local/bin pm2 startup launchd -u <dein-user> --hp /Users/<dein-user>

# 3. Aktuelle Prozessliste speichern (damit PM2 weiß, was gestartet werden soll)
pm2 save
```

**Was passiert dann:**
- macOS erstellt einen LaunchAgent (`~/Library/LaunchAgents/pm2.<user>.plist`)
- Bei jedem Rechner-Neustart startet macOS → PM2 → alle gespeicherten Prozesse (inkl. Bot)
- **Wichtig:** Nach jeder Änderung an PM2-Prozessen (neuer Bot, gestoppter Bot) nochmal `pm2 save` ausführen

### Git & GitHub

```bash
cd ~/projects/alvin-bot
git init
git add package.json package-lock.json tsconfig.json ecosystem.config.cjs .env.example .gitignore CLAUDE.md docs/memory/.gitkeep src/
git commit -m "Initial commit: Claude Agent SDK Telegram Bot"
gh repo create alvin-bot --private --source=. --push
```

**Wichtig:** `.env` ist in `.gitignore` — Secrets werden nicht committed.

### Verwaltungs-Befehle (im normalen Mac Terminal)

| Was | Befehl |
|-----|--------|
| **Status checken** | `pm2 status` |
| **Logs anschauen** | `pm2 logs alvin-bot` |
| **Bot stoppen** | `pm2 stop alvin-bot` |
| **Bot starten** | `pm2 start alvin-bot` |
| **Bot neustarten** | `pm2 restart alvin-bot` |
| **Nach Code-Änderung** | `cd ~/projects/alvin-bot && npm run build && pm2 restart alvin-bot` |
| **Prozessliste speichern** | `pm2 save` |
| **Logs leeren** | `pm2 flush alvin-bot` |

### Troubleshooting

- **Bot crasht in Schleife (viele Restarts):** `pm2 stop alvin-bot && pm2 flush alvin-bot && pm2 start alvin-bot` — stoppt, leert alte Logs, startet sauber neu
- **"Conflict: terminated by other getUpdates request":** Es läuft noch eine andere Bot-Instanz mit dem gleichen Token. Alle anderen stoppen.
- **"Claude Code process exited with code 1":** Wenn aus Claude Code heraus gestartet: `CLAUDECODE` Env-Var muss in der `env` Option gelöscht werden (ist im Code bereits implementiert). Außerhalb von Claude Code tritt das nicht auf.
