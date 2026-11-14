# Grind

A local routine tracker for an Obsidian vault. It reads your daily notes and exam topic checklists, lets you tick things off in one window, and writes every tick straight back to the Markdown files. The vault stays the only record, so anything you change in Obsidian shows up in Grind, and the other way round.

## What it does

- **Today** creates the day's note from a Templater template when you open the app, if it doesn't exist yet. Templater templates run without Obsidian, including JS blocks, `tp.date`, `tp.file` and user scripts. It shows the tasks with their times, marks the current block NOW and missed ones LATE, and tracks a streak (a day counts at 60% done).
- **Habits** is a monthly grid with one row per type of block (Cardio, Maths, Read…) and one column per day, plus %, current streak and tick count for each row.
- **Week** shows Mon–Sun progress, an 8-week trend, and the seven days side by side, each one tickable.
- **Topics** reads `Exams/*checklist*.md`, where each `- [ ]` line is one syllabus topic and its state is held in tags:

  | Tag | Meaning |
  |---|---|
  | `#unstudied` | Not taught (also works on a `##` heading) |
  | `#ontrack` | Being taught now |
  | `#studied (YYYY-MM-DD)` | Taught; needs practice |
  | `#practice`, `#examtechnique` | Needs practice |
  | `#practised (YYYY-MM-DD)` | Last practised / revised |
  | `#revise (YYYY-MM-DD)` | Needs revision |
  | `[x]` | Completed |

  Each time the app loads, any line whose latest `#studied`/`#practised` date is 14+ days old gets `#revise (today)`. Marking it revised removes `#revise` and sets `#practised (today)`. Ticking a routine task that names a topic, such as "Chem 25.1 past Qs" or "Phy 17-20 timed paper", marks the matching lines `#practised`, and you can undo it.
- **Insights** has a consistency chart (7/30/90 days, filterable by subject), a per-subject leaderboard, study hours done vs planned, completion by time of day and weekday, and a calendar heatmap.

## Running it

Requires Node.js 18+ and Windows with Microsoft Edge or Google Chrome.

```bash
git clone https://github.com/d4rkvista/grind-routine-tracker.git
cd grind-routine-tracker
npm install
node server.js
```

On first run Grind asks for your Obsidian vault folder (the one that contains `.obsidian`; pasting a path from Explorer's address bar works). Then it creates today's note and you're in.

The app opens in its own window (Edge/Chrome `--app` mode, with a private profile in `.window-profile/`). It runs only while that window is open, even when minimised, and exits when you close it. It never starts at login. Double-click `Grind.vbs` to start it without a console window (Node must be on PATH); point a desktop shortcut at it.

## Settings

Set these in the app (gear icon); they're stored in `config.json` next to `server.js` (git-ignored, so your paths never get committed):

- vault path (the daily-note folder and date format come from the vault's own Daily Notes settings)
- daily template (Auto = the vault's Daily Notes template, else one with "daily" in its name) and an optional fallback for dates where the main template produces no checkboxes
- streak bar %, the hour the day ends (default 3 AM), and the stats start date
- checklist folder, the "revise after" days, and whether routine ticks update topics

## Layout

```
server.js          local HTTP server, note creation, lifecycle
lib/templater.js   headless Templater runtime
lib/notes.js       task parsing, time parsing, tick toggling
lib/stats.js       streaks and completion stats
lib/checklists.js  exam checklist tags, auto-#revise, routine → topic matching
public/            UI (no framework)
```

Fonts: Space Grotesk and Inter, both under the SIL Open Font License.
