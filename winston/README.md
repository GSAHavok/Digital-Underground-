# Winston

Hands-free voice attendant for recipes and procedures.

Say **Hey Winston**, then the name of a spec. He reads ingredients and steps out loud so you can cook or work without touching the phone.

## What it does

- Always listening for **Hey Winston** (Chrome on Android)
- Loads spec-sheet screenshots from your phone
- Splits stacked photos into separate cards
- Reads ingredients, then steps on **next**
- Closes the card when the last step is done
- Keeps cards on the phone (IndexedDB + backup)

Voice while a card is open: **next**, **repeat**, **back**, **stop**, **ingredients**.

## Run locally

```bash
npm install
npm run dev
```

Open in **Chrome** on your phone for the mic. Allow microphone once, keep the screen on.

## Stack

TanStack Start, React, Web Speech API, xAI vision + TTS.

## Notes

Cards live on the device that uploaded them. Re-add photos if you switch browsers or clear site data.
