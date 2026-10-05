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

**Seed logins.** The passwords come from `SEED_*` in `.env`:
- Super admin: `superadmin@crm.local`
- Business admin: `admin@demo.local`
- Agents: `agent1@demo.local`, `agent2@demo.local`

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

## Not built yet (next steps)

- Online payment gateway (Razorpay or Stripe) for automatic monthly renewal
- Media and header templates, plus button templates
- AI chatbot answers from the business's FAQ (the rule-based bot is built)
- Email notifications, password reset by email
- Moving `uploads/` to S3 or another object store for production
