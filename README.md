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

## Not built yet (next steps)

- Facebook **Lead Ads forms** sync and the **Conversions API** (sending "Converted" back to Meta). Both need extra Meta app permissions and app review.

- Online payment gateway (Razorpay or Stripe) for automatic monthly renewal
- Media and header templates, plus button templates
- AI chatbot answers from the business's FAQ (the rule-based bot is built)
- Email notifications, password reset by email
- Moving `uploads/` to S3 or another object store for production
