# BlueMQ Frontend

Admin/testing UI for BlueMQ.

## Run

```bash
npm install
npm run dev
```

The app talks to backend routes through `/api`.

## Key Screens

- Register App: OTP-based app registration
- Login: OTP login for existing app
- Templates: create and manage channel templates
- Send Notification: enqueue test notifications by channel
- WhatsApp: manage Meta sessions

## Push Testing

In Send Notification, for push channel you can provide either:

- OneSignal Player ID (`onesignal_player_id`)
- Firebase token fields (`fcm_token`, `firebase_token`, or `push_token`)

This keeps testing provider-agnostic when switching push provider flags in backend config.

## Notes

- This frontend is for BlueMQ service testing and operations.
- Do not hardcode app secrets in client-side code.
