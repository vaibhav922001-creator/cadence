# Cadence Health — your own website

This folder is Cadence as a normal website you host yourself. It works on your phone and laptop,
can be added to your home screen like an app, and can connect straight to Google Health.

Everything runs in your browser. Your health data is stored in this browser only (IndexedDB).
There is no Cadence server.

## What's in here

| Path | What it is |
|---|---|
| `dist/` | The finished website. This is what gets published. |
| `.github/workflows/pages.yml` | Publishes `dist/` to GitHub Pages each time you push. |
| `static/` | App icons (copied into `dist/` by the build). |
| `GOOGLE-SETUP.md` | How to get a Google Client ID so Cadence can read Google Health. |

## Put it on GitHub Pages

You need a free GitHub account. No coding needed.

1. Go to github.com and create a **new repository**, for example `cadence`.
   It can be public or private (private Pages needs a paid plan).
2. Upload the **contents** of this `site` folder to the repository, so the repository's top level has
   `dist/`, `static/`, `.github/`, `README.md`. The easiest way: on the new repository page click
   **uploading an existing file** and drag everything in, or use GitHub Desktop.
   - The `.github` folder is hidden on Mac and Windows. Show hidden files (Mac: Cmd+Shift+.) before dragging,
     or create the file in GitHub instead: **Add file → Create new file**, name it
     `.github/workflows/pages.yml`, and paste in the contents.
3. In the repository, open **Settings → Pages**. Under **Build and deployment → Source**, choose **GitHub Actions**.
4. Open the **Actions** tab. The "Deploy Cadence to GitHub Pages" run starts on its own after a push
   (or click it and press **Run workflow**). When it turns green, your site is live at
   `https://<your-username>.github.io/<repository-name>/`.
5. Open that address. You'll see sample data first.

To update later: rebuild (`node build.mjs --site` in the project folder), upload the new `dist/` files, and the
site republishes itself.

## Connect Google Health

1. Follow **[GOOGLE-SETUP.md](GOOGLE-SETUP.md)** to create a Google Cloud project and an OAuth Client ID.
   When it asks for the **Authorized JavaScript origin**, use `https://<your-username>.github.io`
   (just the origin, without the repository name).
2. Open your Cadence site, go to **Data**, paste the Client ID into **Connect Google Health** and save.
   The proxy URL is optional; leave it empty unless GOOGLE-SETUP.md tells you otherwise.
3. Tap **Connect Google Health**, sign in, and allow access.
4. Pick how far back to go (30, 90 or 180 days) and tap **Sync now**. Later syncs only fetch what's new,
   plus the two days before your last sync to catch late data.
5. Optional: turn on **Sync when I open Cadence**. It only runs while Google still has you signed in, and it
   never opens a sign-in window by itself.

The Android Cadence Sync file import still works on the same page.

## Add it to your phone's home screen

- **Android (Chrome):** open your site, tap the **⋮** menu, then **Add to Home screen** or **Install app**.
- **iPhone (Safari):** open your site, tap **Share**, then **Add to Home Screen**.

It then opens full screen with its own icon. The app's files are cached so it opens quickly, even offline.
Your health data is never put in that cache.

## The coach (optional)

On this website the coach uses your own Anthropic API key. Open **Coach**, follow the three steps, and paste
your key. The key is stored only in this browser. Each question is billed to your Anthropic account and
sends a summary of your recent health numbers to Anthropic. Remove the key from the Coach page at any time.

## Privacy

- Your health data, journal and profile are stored in this browser's storage on this device. They don't sync
  between devices. Use **Data → Download backup** to keep a copy or move to another device.
- Google Health data goes directly from Google to your browser. If you set a proxy URL, requests pass through
  that proxy, so only use one you run yourself.
- Your Google Client ID and (if you add it) Anthropic API key are stored in this browser only.
- Clearing your browser's site data for this address deletes everything Cadence stored. Download a backup first.
- Scores are estimates for personal insight, not medical advice.

## Building from source

From the project folder (the one with `build.mjs`):

```
node build.mjs          # claude.ai artifact → dist/index.html
node build.mjs --site   # this website       → site/dist/
```
