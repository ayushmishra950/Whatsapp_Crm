# WhatsApp CRM — mobile app (Expo SDK 57, Expo Router, TypeScript)

Same features as the web CRM (`../web`), same backend (`../server`, REST under `/api`, Socket.IO for live updates).

## Run

```bash
cd app
EXPO_PUBLIC_API_URL=http://localhost:4000 npx expo start   # i = iOS simulator, a = Android emulator
```

`EXPO_PUBLIC_API_URL` = the backend (e.g. `https://your-api.onrender.com`). Default: `http://localhost:4000` (Android emulator: `http://10.0.2.2:4000`).

## Structure

```
src/app/                 routes (every file = a screen)
  _layout.tsx            providers + guards: logged out → login, Super Admin → (admin), others → (app)
  login.tsx
  (app)/                 inside a business
    _layout.tsx          Stack + CountsProvider (tab badges)
    (tabs)/              Today · Inbox · Leads · Tasks · More
    chat/[id].tsx        one WhatsApp chat
    lead/[id].tsx        lead page (overview, history, details, tasks, fees)
    notifications.tsx …  other screens, opened from "More"
  (admin)/               Super Admin panel
src/components/          ui.tsx (design system), chat, leads, fees, walk-in, business-switcher, header, date-field, toast
src/lib/                 api.ts (fetch + token), auth.tsx (session, login, switchBusiness), socket.ts, counts.tsx,
                         business.ts (lead statuses, sources), courses.ts, templates.ts, format.ts, files.ts
src/theme.ts             colours (same palette as the web), spacing, font sizes
```

## Conventions (follow these in every screen)

- **Data**: `api(path, { method, body, query })` from `@/lib/api` (throws `ApiError` with the server's message). Read the matching web page in `../web/app/app/**/page.js` and the route in `../server/src/routes/*.js` for the exact request/response shapes.
- **Session**: `useAuth()` → `{ session, epoch, refresh }`; `useIsAdmin()`, `useIsCoaching()`. Reload screen data when `epoch` changes (business switch): put `epoch` in the load effect deps.
- **Live updates**: `useSocketEvent(event, handler, epoch)`.
- **UI**: only components from `@/components/ui` (`Screen`, `Card`, `Row`, `T`, `Button`, `IconButton`, `Input`, `PasswordInput`, `Field`, `Select`, `Toggle`, `Chip`, `ChipBar`, `Badge`, `StatusBadge`, `Avatar`, `CountBadge`, `Stat`, `InfoLine`, `ListRow`, `Sheet`, `EmptyState`, `Loader`, `Divider`, `SectionTitle`, `confirm`), `DateField` from `@/components/date-field`, colours from `@/theme` (`C`, `S`, `R`, `F`, `TONES`). No new UI libraries.
- **Feedback**: `const toast = useToast()` → `toast.success('…')`, `toast.error(err)`. Destructive / irreversible actions ask first with `await confirm(title, message, { ok, danger: true })`.
- **Screen title / header buttons**: `<Stack.Screen options={{ title: '…', headerRight: () => … }} />` inside the screen.
- **Navigation**: `router.push('/lead/<id>')`, `router.push('/chat/<id>')`, `router.back()`.
- **Lists**: `FlatList` with `RefreshControl` (pull to refresh) for long lists; `Screen` (scrolls, `onRefresh`) for forms / short pages.
- **Forms**: edit in a `Sheet` (bottom sheet) with Cancel / Save in `footer`; numbers via `keyboardType="number-pad"`.
- **Permissions**: hide admin-only actions for counsellors (`useIsAdmin()`), coaching-only things for other businesses (`useIsCoaching()`) — same rules as the web.
- **Text**: English UI labels like the web.
- Check with `npx tsc --noEmit` and `npx expo lint` (no `setState` directly in an effect body: call a loader that sets state in `.then`).

## Push notifications

Alerts (new customer message, hot lead, tasks, fee overdue…) reach the phone even when the app is closed, through the Expo push service.

1. Link the app to an Expo account once: `npx eas-cli@latest init` (adds `extra.eas.projectId` to app.json).
2. Push needs a real phone with a development / store build (`eas build`); Expo Go on Android and simulators can not receive push.
3. The app saves the phone's token on the login after sign-in (`POST /auth/push-token`), removes it on logout, and a tap opens the right business and screen.
Server: `services/push.js` (set `PUSH_DISABLED=true` to switch off, e.g. in tests).

## Server end-to-end tests

`server/tests/` (local dev database only). Start the test API, then run them:

```bash
cd server && MONGO_URI= PORT=4100 LOGIN_RATE_LIMIT=500 PUSH_DISABLED=true CLOUDINARY_CLOUD_NAME= CLOUDINARY_API_KEY= CLOUDINARY_API_SECRET= node src/index.js
cd server && npm run test:e2e
```
