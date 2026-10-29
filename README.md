# Mira

Mira is a privacy-aware human AI companion. It combines:

- local facial-expression and posture cues using MediaPipe Tasks Vision;
- local vocal-energy measurement through the Web Audio API;
- real-time voice and sampled camera understanding through Gemini Live;
- a persistent feminine or masculine voice choice that is reused on every reconnect;
- optional Google sign-in with a private, per-user memory of recent exchanges;
- a text-only local fallback when the free quota, camera, or microphone is unavailable.

## Run locally

Run the Worker artifact through a compatible local runtime after building. Camera access requires `localhost` or HTTPS.

```sh
npm run build
npm test
```

## AI connection

The public Worker reads `GEMINI_API_KEY` from the Sites runtime environment and exchanges it for one-use Gemini Live ephemeral tokens. The permanent key is never included in browser JavaScript or committed files. Google billing is not enabled; when free-tier quota is unavailable, Mira keeps working in local mode.

## Sign-in and memory

Firebase Authentication provides “Continue with Google,” and Cloud Firestore keeps a bounded history of 30 completed exchanges per signed-in user. The rules in `firestore.rules` restrict every profile and memory document to the matching authenticated user ID.

Mira saves conversation text plus the broad cue labels visible in the interface. It does not persist raw audio, video, camera frames, face landmarks, voiceprints, or biometric templates. A signed-in user can review and erase memory from the app; a private guest visit is not retained.

The Firebase web configuration in `public/app.js` identifies this public web app and is safe to ship. Access control comes from Firebase Authentication and the deployed Firestore rules, not from hiding the web configuration.

## GitHub Pages

The `public/` frontend deploys to GitHub Pages through `.github/workflows/pages.yml`. Because Pages cannot run server code or hold a private API key, the GitHub-hosted frontend requests one-use Gemini tokens from Mira's existing Sites Worker. That endpoint accepts only Mira's own Site and `https://dhairya1611.github.io`, keeps the permanent key server-side, and retains the same per-client rate limit.

## Verification

```sh
npm run build
npm test
```

The source UI lives in `public/`; the deployment artifact is generated at `dist/`. Local cue labels are deliberately broad and tentative. They are interface signals, not emotion diagnoses.
