# BotLenoAPP

Discord queue/job management for servers. Users join a job order (PvP, Dungeon, Abyss, Pet Farm, Exploration/Leveling by default), enter how many hours they can work, and the bot calculates **Available until** in the server timezone. Staff manage queues from Discord. **SQLite is the source of truth**; Discord messages are only the UI.

## Requirements

- Node.js 20 or later
- A Discord application with a bot user
- Write access for `./data/botleno.sqlite` (created automatically)

## Discord Developer Portal

1. Create an application at [https://discord.com/developers/applications](https://discord.com/developers/applications).
2. Open **Bot**, create the bot, and copy the token into `DISCORD_TOKEN`.
3. Copy the application ID into `CLIENT_ID`.
4. Disable unused privileged intents. BotLenoAPP only needs the **Guilds** gateway intent.
5. Invite the bot with `bot` and `applications.commands` scopes.

### Invite URL

Replace `YOUR_CLIENT_ID`:

```text
https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=268528656&scope=bot%20applications.commands
```

Do **not** grant Administrator. The permission integer is:

| Permission            | Why                                      |
| --------------------- | ---------------------------------------- |
| View Channel          | Read the category and queue channels     |
| Send Messages         | Panel, dashboard, admin, logs, and command replies |
| Embed Links           | Queue embeds                             |
| Read Message History  | Edit pinned panel/dashboard messages     |
| Manage Channels       | `/setup` creates/repairs channels        |
| Manage Roles          | `/setup` creates/repairs the staff role  |
| Manage Messages       | Pin the panel and status messages        |

The person running `/setup` needs **Manage Server**.

## Environment

Copy `.env.example` to `.env`:

```env
DISCORD_TOKEN=
CLIENT_ID=
DATABASE_PATH=./data/botleno.sqlite
DEFAULT_TIMEZONE=Asia/Manila
LOG_LEVEL=info
DEV_GUILD_ID=
```

| Variable            | Required | Description |
| ------------------- | -------- | ----------- |
| `DISCORD_TOKEN`     | yes      | Bot token. Never commit this. |
| `CLIENT_ID`         | yes      | Application ID. |
| `DATABASE_PATH`     | no       | SQLite file path. `DATABASE_URL=file:./data/botleno.sqlite` also works. |
| `DEFAULT_TIMEZONE`  | no       | IANA zone used for new servers. Default `Asia/Manila`. |
| `LOG_LEVEL`         | no       | `fatal` `error` `warn` `info` `debug` `trace`. |
| `DEV_GUILD_ID`      | no       | If set, `npm run deploy` registers commands on that guild instantly. |

## Install and run (development)

```bash
npm install
cp .env.example .env   # then edit .env
npm run deploy
npm run dev
```

On Windows PowerShell use `Copy-Item .env.example .env`.

`npm run deploy` with `DEV_GUILD_ID` set updates slash commands immediately. Without it, commands are registered globally (can take up to an hour).

## Production

```bash
npm install
npm run deploy
npm run build
NODE_ENV=production npm start
```

### Bot-Hosting.net

This project is TypeScript. The panel default `index.js` is now a bootstrap that compiles `dist/` then starts the bot.

1. Upload the project **without** `node_modules` (Windows binaries will not work on their Linux image).
2. Add a `.env` in `/home/container` with `DISCORD_TOKEN` and `CLIENT_ID`.
3. Startup → **Entry File** = `index.js`. Prefer **Node 22** if the panel offers it.
4. Leave the default install command. `package.json` already allows `better-sqlite3` install scripts so SQLite can compile.
5. Register slash commands from your PC (`npm run deploy`) — you do not need to run that on the host.
6. Restart the server. Do not type `npm install` in the console; the start command already does that.

Process managers (systemd, PM2, Docker) should:

- Set `NODE_ENV=production`
- Point `DATABASE_PATH` at a persistent volume
- Restart on crash
- Send `SIGTERM` on stop (the bot closes Discord and SQLite cleanly)

## `/setup`

Run `/setup` in the target server once. It is idempotent.

**First run** creates:

```text
📁 BotLenoAPP
    🎯 queue-start
    📋 queue-dashboard
    🔒 queue-admin
    📜 queue-logs
Role: BotLenoAPP Staff
Default queues: PvP, Dungeon, Abyss, Pet Farm, Exploration/Leveling
```

`#queue-admin` and `#queue-logs` are hidden from regular members. Staff can talk in `#queue-admin`. `#queue-logs` is read-only for staff (the bot posts activity there). Discord **Administrator** bypasses channel overwrites, so guild admins can still see and type in those channels; everyone else is locked out as tightly as Discord allows.

If a server still has `#queue-panel`, `/setup` (and dashboard refresh) renames it to `#queue-start`.

**Later runs** reuse existing IDs, repair a stored ID if the channel/role still exists by name, and recreate only what is missing. It will not duplicate the category, channels, or staff role.

If the bot is missing a permission, `/setup` lists the exact name (for example `✗ Manage Channels`). If the staff role sits above the bot role, it reports a role hierarchy error instead of failing silently.

## Commands

| Command         | Who        | Purpose |
| --------------- | ---------- | ------- |
| `/queue`        | Everyone   | Open the queue panel |
| `/myqueue`      | Everyone   | Position, people ahead, availability, status |
| `/leavequeue`    | Everyone   | Leave after confirmation |
| `/queue-admin`  | Staff or Manage Server | Panel, skip, remove, complete, pause, resume, open, close, clear, move, history |
| `/send-jo`      | Staff or Manage Server | Offer a J.O. down the READY duty line (20s Yes/No, then next in line) |
| `/queue-config` | Manage Server | Timezone, multiple-queue setting, staff role, per-queue limits |
| `/setup`        | Manage Server | Create or repair Discord infrastructure |

Most members only need the **queue-start** select menu. Commands are fallbacks.

## Queue flow

1. Open `/queue` or the `#queue-start` message.
2. Select a job from the menu.
3. Enter hours (for example `8` or `1.5`, max 24).
4. The bot stores UTC `available_until` and shows local time in the guild timezone.
5. Use **Refresh**, **My Status**, or **Leave Queue**. Leave asks for confirmation.

Users cannot join paused or closed queues, cannot join the same queue twice, and by default cannot hold more than one active entry. Staff can enable multiple queues with `/queue-config multiple`.

Availability expires from the stored timestamp. A background worker checks every 15 seconds and also on queue reads, so restarts do not lose expirations.

## Staff J.O. offers

Staff (BotLenoAPP Staff role or Manage Server) run `/send-jo`, pick a J.O. category, and type the offer. BotLeno DMs the first **READY** person in line who selected that job (skips AFK and ON DUTY). They have **20 seconds** to press Yes or No. Decline or timeout immediately offers the next matching person. Only one offer chain can run per server at a time. If DMs are closed, the offer is posted in `#queue-start` with a mention and auto-deleted afterward.

## Configuration

`/queue-config view` shows timezone, multiple-queue mode, staff role, and per-queue min/max hours.

Queues are data-driven (`src/config/defaults.ts`). Adding a template there seeds new servers; existing servers keep the rows already in SQLite.

## Database

SQLite with WAL, foreign keys, and numbered migrations in `src/database/migrations.ts`. Schema versioning is stored in `schema_migrations`. Repositories in `src/database/store.ts` keep SQL in one place so a later Postgres move is a store swap, not a rewrite of Discord code.

## Tests and checks

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

## Troubleshooting

| Problem | What to check |
| ------- | ------------- |
| Commands missing | Run `npm run deploy`. For global commands wait up to an hour, or set `DEV_GUILD_ID`. |
| Setup cannot continue | Grant the listed channel/role permissions. Move the bot role above **BotLenoAPP Staff**. |
| Panel not updating | Confirm `#queue-start` still exists, then run `/setup` to repair. Queue data is still in SQLite. |
| Wrong clock | Set `/queue-config timezone` to an IANA zone such as `Asia/Manila`. Timestamps in the database are UTC. |
| `better-sqlite3` build error | Use Node 20+ so prebuilds resolve, or install build tools for your OS. |

## License

Private / unlicensed unless you add one.
