# WhatsApp CRM (multi-business)

A WhatsApp CRM where many businesses use one platform. Each business has its own WhatsApp number, team, contacts and chats, and none of it is shared with other businesses.

| Folder | Stack |
|---|---|
| `server/` | Node.js, Express 5, MongoDB (Mongoose), Socket.io |
| `web/` | Next.js 16 (App Router), Tailwind CSS 4 |

## Roles

| Role | What they can do |
|---|---|
| **Super Admin** | Manage businesses (create, suspend, delete), plans and monthly billing, "Login as" a business (every use is audited), view audit logs |
| **Admin** (business owner) | Add, edit and delete agents. Manage contacts, CSV import, templates, bulk campaigns and the WhatsApp number. Change settings |
| **Agent** | Chat with customers (only chats assigned to them, plus the unassigned queue), update leads, send templates. Agents can run bulk campaigns only if the admin allows it |
| **Contact / Lead** | Not a login. This is the customer on WhatsApp |

## Quick start (local)

```bash
# 1. Backend
cd server
npm install
cp .env.example .env      # set JWT_SECRET and ENCRYPTION_KEY
npm run seed              # creates super admin, 3 plans and a demo business
npm run dev               # http://localhost:4000

# 2. Frontend (new terminal)
cd web
npm install
echo "NEXT_PUBLIC_API_URL=http://localhost:4000" > .env.local
npm run dev               # http://localhost:3000
```

If `MONGO_URI` is empty, the server starts a local MongoDB on its own, with data saved in `server/.mongo-data`. For production, set `MONGO_URI` to MongoDB Atlas or your own server.

## Production: serve frontend and API from one URL

The production backend serves the Next.js app for frontend routes and keeps `/api/*` on Express. Socket.IO and uploads also use that same host. Build the frontend before starting the backend:

```bash
cd web
npm install
NEXT_PUBLIC_API_URL= npm run build

cd ../server
npm install
NODE_ENV=production npm start
```

Set production values in `server/.env`, including `MONGO_URI`, `JWT_SECRET`, `ENCRYPTION_KEY`, and `CLIENT_URL=https://<your-domain>`. The build command above clears any local `NEXT_PUBLIC_API_URL` override in `web/.env.local`, so production browser requests use the current page's origin. If the frontend and API use separate public hosts, set `NEXT_PUBLIC_API_URL` to the public API origin when building instead. The production process needs the `web/` dependencies and the built `web/.next` directory available alongside `server/`.

**Seed logins.** The passwords come from `SEED_*` in `.env`:
- Super admin: `superadmin@crm.local`
- Business admin: `admin@demo.local`
- Agents: `agent1@demo.local`, `agent2@demo.local`

### Two separate services (e.g. Render: one for `server/`, one for `web/`)

The backend only serves the frontend when `web/` is installed and built next to it. When the frontend runs as its own service, the backend starts as **API only** (log: `running as API only`). Set `SERVE_FRONTEND=false` to force this.

- **Backend service:** root `server`, build `npm install`, start `npm start`. Env: `NODE_ENV=production`, `MONGO_URI` (e.g. MongoDB Atlas, never `127.0.0.1`), `JWT_SECRET`, the **same** `ENCRYPTION_KEY` as before (otherwise saved WhatsApp tokens can not be decrypted), `WA_APP_SECRET`, `WA_WEBHOOK_VERIFY_TOKEN`, `CLIENT_URL=https://<frontend-url>`. Create the first logins once with `npm run seed` (Render Shell).
- **Frontend service:** root `web`, build `npm install && npm run build`, start `npm start`, env `NEXT_PUBLIC_API_URL=https://<backend-url>`.
- **Meta webhook:** `https://<backend-url>/api/webhook/whatsapp`.

## Sandbox mode vs live WhatsApp

Each business starts in **sandbox mode**. Messages are simulated, and the delivered and read ticks are faked, so you can test the whole CRM without Meta credentials. Go to **Settings → Sandbox** to pretend a customer sent you a message.

**Going live (official WhatsApp Cloud API):**
1. In the Meta App dashboard, set the webhook:
   - Callback URL: `https://<your-api-domain>/api/webhook/whatsapp`
   - Verify token: `WA_WEBHOOK_VERIFY_TOKEN`
   - Subscribe to `messages` and `message_template_status_update`
2. Put the Meta App secret in `WA_APP_SECRET`. It is used to verify webhook signatures.
3. The business admin opens **Settings → WhatsApp number** and enters:
   - Phone number ID
   - WABA ID
   - A permanent System User access token

   The token is stored AES-256-GCM encrypted. The business then switches to **live** mode.

## How it works

- **Data isolation.** Every business-scoped document has a `tenantId`. All business routes go through `requireTenant`, and every query filters by `req.tenantId`.
- **24-hour window.** Free-form text and media can only be sent within 24 hours of the customer's last message. Outside that window, only approved templates can be sent (a WhatsApp rule).
- **Bulk campaigns:**
  - The audience is snapshotted into `CampaignRecipient` rows.
  - A worker sends at `CAMPAIGN_MPS` messages per second.
  - Each recipient is claimed atomically before sending, and a restart resumes where it stopped. No Redis is needed.
  - Opted-out contacts are skipped.
  - The campaign pauses itself when the plan limit or the subscription runs out.
- **Opt-out.** If a customer replies `STOP` (or any configured keyword), they are excluded from campaigns. Replying `START` opts them back in.
- **Monthly billing.** Plans set the limits for agents, contacts and messages per month. Super admin records the payment with "Renew" (+N months). When a subscription expires, sending stops.
- **Message actions:**
  - **Quoted reply.** Uses WhatsApp `context.message_id`, and the customer's swipe-replies are linked to the quoted message.
  - **Customer reactions.** Shown on the message they reacted to.
  - **Internal notes.** The author or an admin can edit or delete them.
  - **Delete own message.** The sender can delete their own message within 48 hours (any time if it failed). An admin can hide any message, at any time.
  - **All deletes are soft deletes.** The original stays in the DB, the action is written to the audit log (`message.delete_own`, `message.hide`, `note.delete`), and the message is NOT removed from the customer's phone, because the Cloud API has no unsend / "delete for everyone".
  - **Send correction.** The Cloud API can not edit a sent message, so the sender re-sends a fixed text that quotes the original.
- **Chatbot (rule-based).** One per business, set up by its Admin on the **Chatbot** page. Super Admin switches it on or off per plan (Plans → "Chatbot module").
  - **Starts** on a customer's first message, or when a resolved chat gets a new message. Opted-out contacts are skipped.
  - **What it does:**
    - Sends a welcome menu: WhatsApp reply buttons for up to 3 options, a list for up to 10. Customers can also type the option number.
    - Answers keyword replies.
    - Asks lead questions; the answers are saved on the contact (name, email, `custom.*`), and the contact gets tagged.
  - **Hands off to a human** when the customer types a handoff word, finishes the lead questions, or isn't understood N times. The chat then goes through normal auto-assignment. Outside business hours the bot sends the offline message instead.
  - **Stops** as soon as someone on the team replies, assigns the chat, or clicks **Take over**. **Hand to bot** sends the menu again.
  - **Inbox:** a "🤖 Bot handling" filter. The "Unassigned" filter excludes chats the bot is still handling.
  - **Loop guard:** after 15 bot replies in 10 minutes, the chat is handed off.
  - Engine: `server/src/services/chatbot.js`.
- **Real-time.** Socket.io rooms per admin team, agent and user mean agents only receive events for the chats they are allowed to see.
- **Lead statuses.** Each business has its own list (default: New, Contacted, Interested, Converted, Not interested). Admins rename, recolor, reorder, add (e.g. "Call back") or remove them in **Settings → Lead statuses**. Leads of a removed status move to "New". Who changed a status and when is stored and used in the team report. Engine: `server/src/services/leadStatuses.js`.
- **Contacts / Leads page:**
  - Status tabs with counts, plus filters for tag, source (Facebook ad), ad, follow-up and search. Inline status change.
  - Select rows, or "select all N matching", then change status, add tags, delete, or **Send bulk message** to them.
  - **Import sheet** (`.xlsx` or `.csv`, up to 10 MB / 50,000 rows): columns are matched automatically, then previewed. Missing country codes are added (default 91). Every import gets a batch tag like `sheet-061026-1239`, and the result screen has a **Send bulk WhatsApp message** button for that batch.
  - **Export** to Excel or CSV (admin only). The current filters are applied.
  - **Follow-up reminders** (date/time + note) per lead. Due follow-ups show on the dashboard and in the inbox.
- **Bulk campaign audience:** all contacts, by lead status, by tags, by Facebook ad, or a hand-picked contact list.
- **Facebook / Instagram ads (Click-to-WhatsApp).** When a customer starts a chat from an ad, the webhook `referral` is saved: the contact gets source "ad", the ad headline/ID (first touch) and the tag `facebook-ad`. The message shows a "📣 From ad" card. Filter leads or send campaigns by ad; the dashboard shows leads and conversions per ad (last 30 days).
- **Dashboard:** lead pipeline, follow-ups due today, leads from ads and (admin only) **Team performance** for 7 or 30 days: chats handled, open chats, messages sent, leads converted, median reply time.
- **Auto lead status from chat.** A customer writing "interested" makes the lead Interested; "not interested" / "interest nahi hai" makes it Not interested. Questions and long messages are ignored, Converted leads are never changed, and an internal "🤖 Auto update" note is added to the chat. Toggle: Settings → Automation. The chat header also has a lead status dropdown.
- **Templates:**
  - **Variables.** Each `{{n}}` gets a default (contact field or fixed text) and an example for Meta's review. Campaigns and inbox template sends start with these defaults. They are CRM-only, so changing them never needs WhatsApp review.
  - **Editing approved templates.** Only header, body and footer can change; name, language and category are locked. The edit goes back to Meta review, with Meta's limits (1 per 24 h, 10 per 30 days) enforced. Not allowed while a scheduled or running campaign uses the template.
  - A rejected template is resubmitted as an edit of the same Meta template.
- **Editing campaigns.** Draft and scheduled campaigns can be edited (name, template, audience, variables, time) until 1 minute before they start; recipients are rebuilt. "Unschedule" turns a campaign back into a draft. Resuming a paused campaign before its time keeps it scheduled.
- **Contact fields.** Settings → Contact fields: admins add, rename or delete custom fields (Course, City…). Name, phone and email are built in. Custom fields can be used in template variables, campaigns and chatbot lead questions, and edited on each contact (Contacts → Edit, Inbox → Details). Extra sheet columns and new chatbot fields are added to the list automatically. A field that a template, an active campaign or the chatbot uses can not be deleted.
- **Smart filter (segments).** Status + tags (any/all, exclude) + ad + source + first contact / last message from the customer (7 / 14 / 30 days, 3 / 6 / 12 months, custom dates) + field conditions (Course = PHP) + birthday/anniversary (today, next 7 days, this/next month) + referred. Live count, saved filters. Used by bulk campaigns ("Smart filter" audience), drips and Contacts (Joined / Last message filters). Engine: `server/src/services/segments.js`.
- **Ads page.** Every Click-to-WhatsApp ad is listed with leads, Interested and Converted. The admin names an ad and sets a tag that every lead from it gets (also existing leads); "Message" opens a campaign for that ad's leads.
- **Drips & automations (admin).** A series of approved templates sent over days. Starts on: new lead (by source), lead from an ad, tag added, status changed, yearly birthday/anniversary (date field, on the day or N days before/after), or added by hand (Contacts → Add to drip, or by smart filter). Optional extra condition; stops on reply and/or on chosen statuses; never to opted-out contacts. Quiet hours (default 21:00–09:00) and a per-contact daily limit (Settings → Automation). Report of everyone in the drip. Worker: `server/src/services/drips.js`.
- **Date fields.** Contact fields can be type "Date" (DOB, Anniversary). Dates are stored as `YYYY-MM-DD` from the contact form, Excel import (DOB/Anniversary columns become date fields) or a chatbot question (asks again on a bad date).
- **Follow-up message.** A follow-up can also send a WhatsApp template to the customer at that time.
- **Refer & earn.** Each contact gets a code and a `wa.me` share link (template variables "Referral code" / "Referral link"). A new lead whose message contains a code is linked to the referrer and tagged `referred`. The Refer & earn page tracks referred / joined and fee discounts given / due (no money handled). Settings → Refer & earn: reward text and value, link number, message.
- **Excel sample + comma tags.** The import offers a sample `.xlsx`; tag boxes accept `php, mern`.
- **Multi-PC / team use.** Admin and agents log in from any number of computers at the same time. Everything updates live, and new customer messages play a sound and show a desktop notification ("Alerts on/off" in the inbox, per browser).
- **Business type (Super Admin).** Each business is **General** or **Coaching institute** (Super Admin → Businesses → create / business page). Only coaching institutes get the coaching format: Courses page, course variables, Hinglish templates and language / course detection, and the 19-status playbook (applied automatically when a business is created as coaching or switched to it; a business that already has the playbook statuses keeps its edits). General businesses use the normal CRM; the general features below (tasks, 🔔, call log, time limits, keyword rules, needs attention, dropdown fields, sources) work for everyone. Engine: `server/src/services/coaching.js`.
- **Lead playbook (Infonic Phase 1 + 2)** — so no lead is lost:
  - **Courses page.** Course catalog (code, name, trigger words, outcome, fees EN/Hinglish, fee ₹, duration, next batch, proof link…), add by hand or **Import Excel** (sample file, matched by Code). A lead's course is set from the ad they clicked (Ads → course) or the words they write; it can be changed on the contact.
  - **Language.** English / Hinglish is detected from the customer's messages (a person can set it, which locks it). Drip steps can have a Hinglish template; course fees / greeting variables use the Hinglish text for Hinglish leads.
  - **Dropdown fields.** Contact fields can be Dropdown or Multi-select with fixed options.
  - **Lead sources.** Besides WhatsApp / ad / import, a lead added by hand can be Website enquiry, Walk-in, Referral, Phone call or Other (filters, smart filter and "new lead" drips use them).
  - **Time limits are safe to switch on:** a new or changed limit counts from when it was set, so old leads are not all moved at once. A lead that comes back to a status gets that status's drip again. STOP also sets the "Opted out" status (if the business has it). Chatbot menu taps do not fire keyword rules. 3 unanswered calls alert the admins.
  - **Stages + time limits.** Every lead status can belong to one of 7 stages (Contacts gets stage tabs) and have a time limit; when it runs out the lead moves to another status and/or a task / alert is created (A6). Coaching institutes can reset to the 19 playbook statuses (Settings → Lead statuses).
  - **Keyword rules (A3/A4).** Words like "join, admission, fees jama" or "mehenga, discount" change the status, add a tag, alert the team and/or create a task. **Lead came back (A8):** a Nurture / Lost lead who writes again moves to Hot with an alert.
  - **One status = one drip.** A status change stops the old status drip; starting a drip stops the lead's other status drips (birthday / manual drips run beside them). Drip steps can also **create a task, alert the counsellor or change the status**, and a drip can move / tag the lead when it ends.
  - **Tasks & alerts.** Tasks page (overdue / due / done, reassign), tasks on each lead (Contacts, Inbox), 🔔 bell with live alerts (hot lead, task, overdue task, reply during a drip, time limit, morning report). A reply during a drip alerts the counsellor. Late tasks alert the owner and the admins.
  - **Call log.** Outcome, note, new status and next action on every call; call count on the lead; open call tasks are closed.
  - **Needs attention (A11).** Dashboard card and a morning report: overdue tasks, leads without a next action, customers waiting > 30 min. Contacts filter "No next action".
  - **More template variables:** course name / outcome / next batch / fee per day / fees / greeting / duration / internship / proof link, counsellor name, business name, review link, proof link, offer end date, address, Maps link, payment details (Settings → Message info).
  - Engine: `server/src/services/automation.js` (worker every minute) and `server/src/services/alerts.js`.
- **Slow / dropped database connections.** Some networks silently drop the TCP connection to MongoDB Atlas. The server uses a socket timeout (`DB_SOCKET_TIMEOUT_MS`, default 4 s), never reuses connections idle > 15 s (`DB_MAX_IDLE_MS`), and retries reads (never writes) up to 2 more times, so a page waits a few seconds at most instead of ~19 s or failing. Big inserts (campaign recipients, drip enrollments, imports) run in batches of 1000. Plans are cached for 1 minute in the auth middleware (cleared when the Super Admin edits a plan).
- **Coaching industry pack** (`server/src/presets/coaching/`, loader `server/src/services/coachingContent.js`). Built from the Infonic playbooks but made general for any coaching institute: 90 WhatsApp templates × English + Hinglish (180 drafts, with quick-reply buttons), 25 drips (D1–D19 lead drips with their triggers, timings, tasks and "when finished" moves; D20–D28 operations drips are added-by-hand), 10 contact fields (mode, city, profile, goal, track, call-back time, demo time, batch month, DOB, joining date) and the playbook sending rules (10 am–7 pm, 1 message a day). The institute's own facts are variables: name, address, city, students trained, since year, rating, review link (Settings → Message info); a drip can not be turned on until the details its messages use are filled. Loaded automatically when a business is created as / switched to Coaching, or from Settings → Coaching industry pack. The 51-course catalog is an optional sample (Super Admin create form checkbox, or Settings button) for IT / skill-training institutes. Steps timed from a demo / call-back / due date or fired by events (payment, absence, new job…) are not in the automatic drips; their templates are there to send from the inbox or a campaign.
- **Template buttons.** Templates can have quick-reply, link and call buttons (sent to WhatsApp for approval; a tap comes back as the customer's reply). Drip steps can wait days + hours/minutes.
- **Logo.** Each business can have a logo in the sidebar (Settings → Business profile, or Super Admin → business page while onboarding). Stored as a small PNG/JPEG/WebP data URL in the DB (survives redeploys); SVG is refused.
- **Contacts filters.** Counsellor (all / me / not assigned / each member), course, next action, plus "More filters": tag, source / ad, follow-up, joined (presets or dates), last message, no reply for N days, calls (never / 1+ / 3+), language, opted out. Active filters show as removable chips; bulk actions and Excel export use the same filters. **Saved views**: save the current filters by name; admins can share a view with the team. A lead's counsellor follows its chat's assignment (old data is synced at server start).
- **Course chatbot (coaching).** A menu option with action "Show course list" opens the course areas → courses (from the Courses page, 10-row lists with "More…") → the course greeting with Fees / Details / Free demo buttons. After the fees the bot asks "Are you interested?" (Yes / More info / Not now). Yes → admission questions (what they do, goal, classroom or online, when to start, name and city if not known, call time), saved on the lead → booking: status New – Call pending (Interested – Hot if they start this month), tag `bot-booked`, a call task for the assigned counsellor, a 🔔 alert, a summary note, and the chat goes to the team. Not now → Nurture – Later. A lead from a course ad, or whose message names a course ("python course fees?"), goes straight to that course (or its fees). English or Hinglish by the lead's language. Coaching businesses get this menu ready (bot stays off until the admin turns it on); a customised bot just gets "Explore courses" added on top. Engine: `server/src/services/courseBot.js`. Typed questions are answered at any point from **FAQ answers** (62 from the playbook, made general: fees, EMI, duration, batch, timing, location, online / classroom, placement, salary, internship, certificate, eligibility, English / coding fear, trust, YouTube, cheaper institute, family, later, no time, far away, refund / complaint → team, …) in English or Hinglish, filled with the course's and institute's own details; a sentence whose value is not filled is left out, and with nothing left the bot says the counsellor will share it. A question asked in the middle of the admission questions is answered and the same question asked again; a course named in the message ("python ki fees") is used for the answer. Admission questions and FAQ answers are editable on the Chatbot page (search, keywords, EN / Hinglish text, on / off, restore defaults).
- **Today (action center).** One page with what to do now, in priority order: new leads never called, tasks due / overdue, hot leads, customers waiting > 30 min, fees due today / overdue, follow-ups. Every row has Call (tel:), Chat, Log call and "Next follow-up". Sidebar badges: Today, Inbox (unread), Contacts (new leads to call), Tasks (due), Fees (due).
- **Done → next follow-up.** Marking a task done (Today, Tasks, a lead's task box) asks for the next follow-up (later today, tomorrow 11 am, in 3 days, next week, or a date). Cancelling a task asks for confirmation.
- **Fees (coaching).** Fee plan per student (total, discount, instalments — "Split monthly"), payments (amount, date, mode, receipt no.), paid / balance / next due. First payment of a Fee pending / Hot lead moves it to Converted – Enrolled; a WhatsApp receipt goes out (approved `payment_receipt` template). Reminders: 3 days before, on the day and a day after a due date (`fee_due_soon` / `fee_due_today` / `fee_overdue`), plus a task and alert for overdue fees; "Need more time" / "Paid" replies create a task. Fees page: collected this month, pending, due in 7 days, overdue students. Template variables `fee.*`.
- **Dashboard: customers & WhatsApp cost.** New vs returning customers per day, messages in / out, and the estimated cost of template messages (marketing / utility rates in Settings → WhatsApp rates).
- **Drips page** in playbook batches (D1… order), search, On / Off filter, sort; turning a drip on / off asks for confirmation.
- **Chatbot formatting:** course names, ₹ amounts and key lines in *bold*, emojis, a blank line between parts; course details and fees include the course's website page (Courses → Website page, `{{course.link}}`).
- **Excel import of old queries:** also Course, Counsellor, Follow-up date, Notes and Enquiry date columns (sample file updated); "Start drips" is off by default so old enquiries do not get the welcome series.
- **Walk-in / quick add.** The green "Walk-in / new enquiry" button (sidebar, Today, Contacts) asks only name + mobile (course, language, note optional; 10-digit numbers get +91). The lead is saved, tagged `walk-in` (or phone call / referral / website), a note is added, and the welcome template goes out on WhatsApp at once: approved `walkin_welcome_en` / `_hi` (buttons "Explore courses" / "Talk to counsellor" open the chatbot), or another approved template the admin picks in the form. A number already in the CRM is updated, never duplicated. A counsellor who adds a visitor owns the lead.
- **Lead page** (`/app/contacts/<id>`, opened by clicking a name or number anywhere): at-a-glance cards (first enquiry and source, course interested / joined, fees paid / balance / next due, calls and last outcome, when the customer last wrote, next action), active drips, the editable details panel, the full history (enquiry, visits, calls, notes, status changes with who did them, tasks created / done, fees, templates and drips; chat messages optional) with a quick note box, and the WhatsApp chat with reply / template / note.
- **Excel import:** only the Phone and Name columns are required; every other column is optional and empty cells never overwrite saved details. Rows without a name are still saved (and counted).
- **Course history.** Every course a lead opens in the chatbot is noted in their history (📘 "Digital Marketing (DM): opened the course, checked the fees", "said YES, interested ✅", "asked for a free demo", "said not now", "Course changed: DM → PY (chose it in the chatbot)"), once per course and action. The lead keeps the list of courses looked at (`courseInterest`), shown on the lead page ("Also looked at") and in the details panel. A team member changing the course adds a note with who did it.
- **"typing…" while the bot answers.** When the chatbot is going to answer a customer message, the CRM first tells WhatsApp to show "typing…" on the customer's phone (Cloud API typing indicator, Graph `v23.0` by default, `WA_TYPING_GRAPH_VERSION` to change). It also marks their message read (blue ticks) and disappears when the reply arrives or after 25 s. Not sent when a person handles the chat, when the bot is off, or in sandbox mode. Chatbot page → "Show typing… while the bot answers" turns it off. WhatsApp does not tell businesses when a *customer* is typing, so that cannot be shown in the CRM.
- **One login, several businesses.** A person's login (email + password) is an `Account`; each business they work in is a `User` membership (admin / agent) pointing at it, so everything else in the CRM works per business as before. The sidebar's business name opens the switcher: every business of the login with its unread chats / tasks due (a red dot when another business has something waiting); a tap opens it without logging out, and the next login opens the business used last. Logins are joined only with proof: the Super Admin creates a business for an admin who "already has a login", a business admin adds an existing login to their Team (no password: the person keeps theirs, and only they can change it), or the person links a second login by typing its password (that email then stops working as a login). A password change applies to all of the person's businesses. Each business keeps its own email, WhatsApp number, leads, team, plan and billing. Existing users get their login automatically at server start (`migrateAccounts`, safe to run again). `LOGIN_RATE_LIMIT` (default 20 logins / 15 min per IP).

## Instagram DMs (second channel)

Instagram DMs come into the same inbox as WhatsApp (Instagram API with Instagram Login, `graph.instagram.com`).

- **Leads and chats.** A lead is a WhatsApp number *or* an Instagram user (`Contact.instagram.igsid`, `username`, `name`, `profilePic`); `phone` is optional. A lead has one chat per app (`Conversation.channel` = `whatsapp` | `instagram`); the lead page switches between them. Messages keep `igMessageId` (WhatsApp: `waMessageId`).
- **Inbound.** Meta → `POST /api/webhook/instagram` (signed with `IG_APP_SECRET`, else `WA_APP_SECRET`) → `services/instagramInbound.js` (DMs, photos / video / audio / PDF kept in storage at once, story replies and mentions, quick-reply taps, reactions, "seen", ad referrals, messages the business typed in the Instagram app) → `ingestInbound()` in `services/webhookProcessor.js`, the same core WhatsApp uses (opt-out, automations, chatbot, drips, assignment, alerts).
- **Outbound.** `sendOutbound()` sends by the chat's app (`services/instagram.js`): text (1000 bytes), chatbot menus as quick replies (max 13), photo 8 MB, video / audio 25 MB, PDF only. Files go by a public link (Cloudinary, or `PUBLIC_URL` + `/uploads`). 24-hour window like WhatsApp; there are no templates on Instagram, so bulk campaigns, drips, fee reminders, follow-up messages and the walk-in welcome use WhatsApp only and leave Instagram-only leads out.
- **Connecting.** Settings → Instagram → Connect (admin) → Instagram login → `GET /api/instagram/callback` → long-lived token (~60 days, encrypted) + webhook subscription. A worker renews tokens before they expire and alerts the admins if it can not. Disconnect in the same place. Plans have an Instagram module (Super Admin → Plans).
- **Sandbox.** Until an account is connected, Settings → Instagram → "Simulate Instagram DM" (`POST /api/sandbox/instagram`).
- **Database update (one time).** `services/channelMigration.js` marks old chats as WhatsApp and replaces the old "one lead per phone" / "one chat per lead" indexes. It runs by itself on a local database; on production take a backup, set `CHANNEL_MIGRATION=run` in `server/.env` and restart. Until then WhatsApp works as before and Instagram messages are not taken in.
- **Meta App setup.** Instagram product in the same Meta App → `IG_APP_ID`, `IG_APP_SECRET` (if different), `IG_WEBHOOK_VERIFY_TOKEN`, `IG_REDIRECT_URL` (`<API>/api/instagram/callback`, registered in the App Dashboard), `PUBLIC_URL`. Webhook callback `<API>/api/webhook/instagram`, fields: messages, messaging_postbacks, messaging_seen, message_reactions, messaging_referral. Permissions `instagram_business_basic` + `instagram_business_manage_messages` (App Review / Advanced Access for client businesses).
- **Tests.** `server/tests/instagram.mjs` (34) and `igconnect.mjs` (25), with the rest: `npm run test:e2e`.

## Mobile app (`app/`)

Expo SDK 57 + Expo Router (TypeScript), same backend and the same features as the web: login with the business switcher (one login, several businesses), Today, Inbox and live WhatsApp chat (reply, templates, notes, assign, resolve, bot take-over), Leads (filters, Excel import / export), the lead page (overview, history, details, tasks, fees), walk-in quick add, Tasks, Dashboard, Fees, Notifications, Bulk campaigns, Templates, Drips, Chatbot, Courses, Ads, Refer & earn, Team, Settings (incl. logo upload), and the Super Admin panel. See `app/DEVELOPMENT.md`.

```bash
cd app && EXPO_PUBLIC_API_URL=https://your-api.example.com npx expo start
```
- **File storage (chat photos / documents).** `server/src/services/storage.js`: `STORAGE_DRIVER=cloudinary` with `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (optional `CLOUDINARY_FOLDER`) keeps every file sent from the CRM, and every customer file the first time it is opened, on Cloudinary (one folder per business, random file names). Without the keys, or if Cloudinary fails, the file waits in `server/uploads/` so the chat still works (`DiskFile` queue): every 5 minutes the worker uploads it again (backoff up to a day), switches the chat to the cloud link and deletes the disk copy. Admins get a bell + phone alert when a file can never upload (e.g. too big), when the keys are wrong, or when more than `DISK_ALERT_FILES` (100) files / `DISK_ALERT_MB` (500) MB are waiting — once a day each. Settings → "Files on server disk" (web and app) lists them with name, customer and reason: open, retry now or delete (the chat then shows "file removed by admin"; audit-logged). WhatsApp rules are checked before sending: JPG/PNG photos up to 5 MB, MP4/3GP video, AAC/MP3/M4A/AMR/OGG audio, PDF/Word/Excel/PowerPoint/TXT documents, 16 MB max; the mobile app converts iPhone HEIC photos to JPG by itself.

## Not built yet (next steps)

- Facebook **Lead Ads forms** sync and the **Conversions API** (sending "Converted" back to Meta). Both need extra Meta app permissions and app review.

- Online payment gateway (Razorpay or Stripe) for automatic monthly renewal
- Media and header templates, plus button templates
- AI chatbot answers from the business's FAQ (the rule-based bot is built)
- Email notifications, password reset by email
- Moving `uploads/` to S3 or another object store for production
