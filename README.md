# Sakinah Research — Personal Observational Study

A separate research app for tracking the relationship between agreed physical boundaries and daily calm, tension, anger, disagreements, and happiness.

**This project lives only in [nmpersonal00-oss/data-analysis](https://github.com/nmpersonal00-oss/data-analysis). It does not import code, data, keys or configuration from any other app.**

## What works

| Feature | Status |
| --- | --- |
| Mobile-responsive dashboard | Complete |
| Encrypted local browser database (IndexedDB, AES-GCM) | Complete |
| Passphrase locking and unlocking | Complete |
| Two participant nicknames within one shared vault | Complete |
| Daily questionnaires for each person | Complete |
| Optional notable-event timeline | Complete |
| Fixed study protocol and manual stopping rule | Complete |
| Audit history of diary edits and deletions | Complete |
| Missing-day tracking, mean/median/SD, episode totals | Complete |
| Trend charts showing gaps between missed days | Complete |
| Plaintext CSV export; encrypted backup and restore | Complete |
| Independent remote logins and automatic two-phone sync | **Not connected** |
| Separate secure cloud Postgres schema | **Template only; not deployed** |

The app works immediately using a REAL encrypted on-device IndexedDB database. Both people can use the **same device and browser** by choosing their participant nickname. However, this is **one shared vault**: anyone with the common passphrase can read and edit both people's records. Selecting a nickname is not independent authentication. **Two phones do not automatically sync.**

## How to open it

1. Go to [your data-analysis GitHub repository](https://github.com/nmpersonal00-oss/data-analysis) and select **Settings → Pages**.
2. Choose **Deploy from a branch**, select **main** and **/(root)**, then save.
3. Open the HTTPS website shown by GitHub when deployment succeeds. It may resemble https://nmpersonal00-oss.github.io/data-analysis/ — use the address GitHub actually provides.
4. Create a vault with two nicknames, a reporting time zone, and a **unique 12+ character passphrase**. Do not reuse passwords from other apps.
5. Select the participant entering today's observations and fill in the diary. Regularly download an **encrypted backup** from **Data & privacy**.

The browser encryption API requires a secure context; HTTPS is recommended. Do not rely on private/incognito browsing for long-term storage.

## Protocol v1.0.0

**Research question:** Do my fiancée and I experience more calm and fewer episodes of tension or anger during a period when we maintain the four boundaries?

**Background and hypothesis:** Earlier experiences without touching or showing our bodies to each other seemed calmer. Islamic beliefs motivate the question, but spiritual outcomes are not measured. The hypothesis is that days within this period may feature fewer disagreements, lower tension and anger, and higher calm.

**Start:** November 13, **2026**, using one chosen study reporting time zone.

**Boundaries:**
1. Refrain from physical contact with one another.
2. Keep bodies covered in each other's presence.
3. Refrain from sexual flirting.
4. Refrain from undressing in front of one another, even for nonsexual reasons.

**Stopping rule:** End the observation as soon as either person reports crossing any boundary. Either person may also stop or withdraw voluntarily. The UI makes records read-only afterward and retains exports for review.

**Consent:** The study is voluntary. Scores must never be used to pressure, shame, surveil or punish either participant. This is not therapy.

## Data dictionary and measuring consistency

All core scales use whole numbers from 0 to 10.

| Variable | Definition |
| --- | --- |
| calm | 0 = not calm, 10 = very calm |
| tension | 0 = none, 10 = very high |
| anger | 0 = none, 10 = very high |
| happiness | 0 = none, 10 = very happy |
| closeness | 0 = none, 10 = very close |
| communication | Optional quality rating, 0–10 |
| externalStress | Optional outside-stress rating, 0–10 |
| disagreements | Count of distinct tense disagreements, 0–30 |
| tensionEpisodes | Count of distinct tension episodes, 0–30 |
| angerEpisodes | Count of distinct anger episodes, 0–30 |
| sleepHours | Optional duration of prior-night sleep, 0–24 |
| togetherMinutes | Optional minutes together, 0–1,440 |
| notes | Optional contextual observations |

**Operational episode rule:** Count a sustained tension or anger episode lasting **at least 5 minutes**. Count another episode only after **15 calmer minutes** between occurrences. A disagreement may overlap with tension or anger, so category counts can overlap. These rules are pragmatic definitions, not validated clinical instruments.

The Events tab is a secondary contextual timeline with type, timestamp, severity, duration and notes. **Daily episode counts are entered separately** and serve as the primary frequency outcomes.

Try completing your own observations at a similar time daily without viewing the other person's answers first. If filling in past days, note potential recall bias. Do not invent entries for dates you cannot recall. A recorded zero means no episode; a day without a diary is **missing**, not zero.

## Prespecified analysis

**Primary descriptive outcomes:** Mean calm, tension and anger per recorded day, total and per-recorded-day counts of disagreements, tension episodes and anger episodes, plus diary completeness.

**Secondary descriptive outcomes:** Happiness, closeness, communication, external stress, sleep and time together.

The Analysis view computes separate participant summaries, mean, median, sample standard deviation, coverage and trends. It does not interpolate over unrecorded dates.

**Limits:** This is a one-relationship, two-person observational study with recalled historical experiences rather than measured baseline data. The observations cannot establish that boundaries *caused* any difference. Outside stress, sleep, communication, expectancy and boundary-triggered stopping may explain observed patterns. No p-values, randomized comparisons, spiritual-outcome measurements or efficacy claims are appropriate.

## Privacy and backup

- Encrypted nicknames, diaries, event notes and revision history are held in this browser only. The key is derived from a user-held passphrase using PBKDF2-HMAC-SHA256 (310,000 iterations); the data are encrypted with AES-256-GCM.
- **Anyone with the shared passphrase can access both people's entries.** Local mode does not separate privileges between the two people.
- This local stopping rule is not tamper-proof against old backups or developer tools.
- Clearing browser/site data, losing a device or forgetting the passphrase can make records unrecoverable. Back up frequently.
- Encrypted JSON backups can be restored into an **empty** vault. Do not treat exporting/importing two diverged backups as synchronization.
- **CSV is unencrypted plaintext** even when source data were encrypted. Store it privately and obtain each person's consent before sharing.
- No private observations are committed to GitHub.

## Optional cloud backend — NOT YET CONNECTED

The SQL file [supabase/schema.sql](supabase/schema.sql) describes a **dedicated**, authenticated Postgres backend for future separate accounts and two-phone synchronization. It has per-person row-level security, single-use invitation tokens, server-enforced stopping, and correction history.

**It has not been run on any Supabase project, and the current website does not connect to it.** For cloud sync, create a completely new Supabase project in an organization chosen by you, configure authentication and integrate the research client. **Never run this SQL in Wifey & Hubby or any existing app's project.**

## Source code and testing

This is a static HTML/CSS/JavaScript app with no runtime package dependencies.

- index.html — screens, input forms and protocol display
- styles.css — responsive design
- db.js — encrypted IndexedDB storage and backups
- analytics.js — reproducible descriptive statistics and CSV
- app.js — forms, charts, state management and stop rule
- tests/analytics.test.js — statistical and data-integrity tests
- supabase/schema.sql — unapplied future dedicated database schema
- package.json — run the tests using the command **npm test**

The only GitHub repository changed for this new app is **nmpersonal00-oss/data-analysis**.