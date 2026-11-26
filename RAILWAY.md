# aerastudios.de auf Railway

Ein Node-Server liefert die Website aus und stellt unter `/admin` das Postfach bereit.
Die Installer bleiben bei GitHub Releases.

## Einrichten
1. railway.com → **New Project** → **Deploy from GitHub repo** → `desuee/aera-website`.
2. Im Service unter **Variables**:
   - `ALLOWED_USERS` = `kontakt@aerastudios.de` (weitere mit Komma, z. B. `apply@aerastudios.de`)
   - `IMAP_HOST` = IMAP-Server deines Mail-Anbieters (Standard `dmail01.bero-host.de`, Port 993)
   - `SMTP_HOST` = SMTP-Server (Standard wie IMAP, Port 465)
   - `RESEND_API_KEY` = API-Key von resend.com (nötig zum **Senden**, siehe unten)
3. **Settings → Networking → Custom Domain** → `www.aerastudios.de`. Railway zeigt ein CNAME-Ziel an.
4. Beim Domain-Anbieter den CNAME-Eintrag `www` auf dieses Ziel setzen.
5. `PUBLIC_URL` = `https://www.aerastudios.de` setzen. Die alte Adresse www.dev-dsue.de leitet dann dorthin weiter
   (API, Discord-Logins und Webhooks antworten weiter auch unter dem alten Namen – ältere Spielversionen kennen nur den).

Das Passwort des Postfachs wird nirgends gespeichert: Es wird beim Anmelden vom Mailserver geprüft
und nur verschlüsselt im Arbeitsspeicher gehalten, bis du dich abmeldest (oder nach 60 Minuten Inaktivität).

## Studio (/admin/studio): Changelogs und Downloads
Mit demselben Login wie das Postfach. Damit Änderungen dauerhaft bleiben, schreibt das Studio direkt nach GitHub:
Changelogs und Versionen als `data/*.json` ins Repository, Programmdateien ins neueste GitHub-Release.
- Variable `GITHUB_TOKEN` = Fine-grained Token (github.com → Settings → Developer settings → Fine-grained tokens),
  nur für das Repository `desuee/aera-website`, Berechtigung **Contents: Read and write**.
- Ohne Token kann man im Studio alles ansehen, aber nichts veröffentlichen.

## Beta-Bereich (/beta): Login mit Discord, private Downloads
Beta-Tester melden sich mit Discord an. Wer auf dem AERA-Server eine der Rollen in `BETA_ROLE_IDS` hat, sieht den
neuesten Build. Die Installer liegen als Releases im **privaten** Repository `desuee/aera-beta`; der Server reicht sie
nur an angemeldete Tester weiter.
- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` – Discord Developer Portal → deine App → OAuth2
- Redirect im Portal eintragen: `https://www.aerastudios.de/beta/callback`
- `DISCORD_GUILD_ID` – ID des AERA-Servers
- `BETA_ROLE_IDS` – IDs der Rollen Beta Tester und Developer, mit Komma getrennt
- `BETA_GITHUB_TOKEN` – Fine-grained Token, nur `desuee/aera-beta`, **Contents: Read-only**
- optional `PUBLIC_URL` (auf `https://www.aerastudios.de` setzen; ohne Variable gilt noch der alte Name www.dev-dsue.de), `SESSION_DAYS` (Standard 7)

Neuen Build veröffentlichen: github.com/desuee/aera-beta → Releases → Draft a new release → Tag z. B. `v0.9.3`,
Titel, Text („Was ist neu“), Exe reinziehen → Publish. Die Seite zeigt ihn sofort (spätestens nach 1 Minute).


## E-Mails senden (Resend)
Railway sperrt im Hobby-Plan alle ausgehenden SMTP-Verbindungen. Ohne Umweg lädt „Senden“ deshalb ewig.
Mit `RESEND_API_KEY` verschickt der Server die Mails stattdessen über HTTPS (resend.com, 3.000 Mails/Monat gratis).
Empfangen, Ordner und die Kopie in „Gesendet“ laufen weiter über deinen Mail-Anbieter.
1. resend.com → Konto anlegen → **Domains → Add Domain** → `aerastudios.de` (Region EU).
2. Die angezeigten DNS-Einträge (TXT für DKIM, MX + TXT für `send.aerastudios.de`) beim Domain-Anbieter eintragen.
   Deine normalen MX-Einträge bleiben unverändert. Warten, bis die Domain „Verified“ ist.
3. **API Keys → Create API Key** (Berechtigung „Sending access“, Domain `aerastudios.de`).
4. Auf Railway die Variable `RESEND_API_KEY` setzen → der Service startet neu.
Kontaktformular und Bewerbungen (/join) gehen ebenfalls über Resend: Kontakt an `kontakt@aerastudios.de`, Bewerbungen an
`apply@aerastudios.de`. Als Absender probiert der Server zuerst die aerastudios.de-Adressen, dann die alte dev-dsue.de-Adresse;
Fehler stehen im Railway-Log als `form mail resend …`.
Alternative: Railway Pro-Plan, dann funktioniert SMTP direkt (dann `RESEND_API_KEY` weglassen).

## Signatur & Vorlagen
Im Fenster „Neue E-Mail“ unten: **Vorlage …** fügt eine Vorlage ein (`[Name]` = Vorname des Empfängers),
das Zahnrad öffnet „Signatur & Vorlagen“. Mit `GITHUB_TOKEN` wird beides als `data/mail.json` dauerhaft gespeichert,
sonst nur im Browser.

## AERA Online (Ranked, Multiplayer, Login mit Discord im Spiel)
Läuft im selben Server (`aera-online.js`) und nutzt dieselbe Discord-App wie der Beta-Bereich.
1. Discord Developer Portal → deine App → **OAuth2 → Redirects** → zusätzlich eintragen:
   `https://www.aerastudios.de/aera/auth/callback` (die Beta-Redirect-URL bleibt drin).
   `DISCORD_CLIENT_ID` und `DISCORD_CLIENT_SECRET` sind schon gesetzt – nichts Neues nötig.
2. Railway → Service → **Volumes → New Volume** → Mount Path `/data`.
   Dann unter **Variables**: `AERA_DATA_DIR` = `/data`. Ohne Volume gehen Ratings bei jedem Deploy verloren.
3. Fertig. Prüfen: `https://www.aerastudios.de/api/aera/status` zeigt `"login":true,"storage":true`.
   Bestenliste: `https://www.aerastudios.de/aera/ranked`. Multiplayer läuft über WebSocket `wss://www.aerastudios.de/aera/ws`.
Niemals `AERA_DEV_AUTH` oder `AERA_DEV_FAST` auf Railway setzen – das ist nur für lokale Tests.
