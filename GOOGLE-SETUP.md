# Connect Cadence to Google Health

Cadence can read your Fitbit Air data straight from your Google Health account.
You set this up once. It takes about 15 minutes. It is free.

Your data goes from Google to your browser. It is not sent to any other server.
The sign-in token is kept in memory only. Closing the tab forgets it.

You need:
- The Google account you use in the Google Health app.
- The web address of your Cadence site, for example `https://USERNAME.github.io`.

---

## 1. Create a Google Cloud project

1. Open https://console.cloud.google.com/ and sign in with your Google Health account.
2. Click the project picker at the top, then **New project**.
3. Name it `Cadence`. Click **Create**.
4. Make sure the new project is selected at the top of the page.

## 2. Turn on the Google Health API

1. Open **APIs & Services → Library**.
2. Search for **Google Health API**.
3. Open it and click **Enable**.

## 3. Set up the consent screen

1. Open **APIs & Services → OAuth consent screen** (it may be called **Google Auth Platform**).
2. Click **Get started**.
3. App name: `Cadence`. Support email: your email.
4. Audience: choose **External**.
5. Contact email: your email. Accept the policy. Click **Create**.
6. Open **Audience**. Leave the status as **Testing**.
7. Under **Test users**, click **Add users**. Add your own Google email. Save.
8. Open **Data Access**. Click **Add or remove scopes**.
9. Add these three scopes (paste them in the "Manually add scopes" box if they are not in the list):
   - `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly`
   - `https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly`
   - `https://www.googleapis.com/auth/googlehealth.sleep.readonly`
10. Click **Update**, then **Save**.

All three are read-only. Cadence cannot change or delete anything in your account.

## 4. Create the Client ID

1. Open **APIs & Services → Credentials** (or **Clients**).
2. Click **Create credentials → OAuth client ID**.
3. Application type: **Web application**. Name: `Cadence web`.
4. Under **Authorized JavaScript origins**, click **Add URI**.
   Enter your site address, for example `https://USERNAME.github.io`.
   - Use only the scheme and host. No path and no trailing slash.
   - If you also test on your own computer, add `http://localhost:8000` (or the port you use).
5. Leave **Authorized redirect URIs** empty. Cadence does not need one.
6. Click **Create**.
7. Copy the **Client ID**. It ends in `.apps.googleusercontent.com`.
   You do not need the client secret. Do not put the secret in Cadence.

A new origin can take a few minutes to start working.

## 5. Connect in Cadence

1. Open Cadence and go to **Data**.
2. Paste the Client ID into **Google Client ID**.
3. Click **Connect Google Health**.
4. A Google window opens. Pick your account.

### The "Google hasn't verified this app" screen

You will see this screen. It is expected. The app is yours and is in testing mode.

1. Click **Advanced** (or **Continue**).
2. Click **Go to Cadence (unsafe)**.
3. Tick every Google Health permission. Click **Continue**.

If you untick a permission, the matching data will be missing.

## 6. Sync

1. Click **Sync**. The first sync reads the last 90 days. It can take a few minutes.
2. Cadence shows which data types came through.
3. Later syncs only need a click.

---

## Limits to know

- **Testing mode.** Only the test users you added can sign in. That is fine for personal use.
  You do not need to publish or verify the app.
- **Sign-in lasts 1 hour.** After that, click **Sync** again. Google may show a short sign-in window.
  Cadence does not keep a long-lived token, so it cannot sync in the background.
- **Testing-mode consent may expire after 7 days.** If Google asks you to approve again, approve it.
- **Fitbit Air data must reach Google first.** Open the Google Health app on your phone so it syncs.
  Cadence can only read what Google already has.
- **Some values need sleep.** HRV, breathing rate, blood oxygen and skin temperature come from nights
  you wore the tracker to bed.
- **Request limits.** Google limits how often you can call the API. If you see "Google is limiting
  requests", wait a few minutes and sync again.

## If something goes wrong

| Message | What to do |
|---|---|
| "Google Health API is not turned on" | Do step 2 again in the same project as the Client ID. |
| "Google did not allow Cadence to read this data" | Check step 3.9, then click Connect and tick every box. |
| "Your Google sign-in has expired" | Click Connect or Sync again. |
| "The sign-in window was blocked" | Allow pop-ups for your Cadence site. |
| `redirect_uri_mismatch` or `origin_mismatch` | The site address in step 4.4 must match the address bar exactly. |
| "Access blocked: app has not completed verification" | Add your email as a test user (step 3.7). |
| "Your browser blocked the request" | Set up the proxy below. |

---

## Optional: the proxy (only if your browser blocks the request)

Google's APIs normally allow direct calls from a web page. If Cadence says
"Your browser blocked the request", a privacy extension or network may be stopping it.
Try another browser first. If that does not help, run this small free proxy.
It only forwards your requests to Google Health. It stores nothing.

1. Sign up at https://dash.cloudflare.com/ (free plan).
2. Open **Workers & Pages → Create → Create Worker**. Name it `cadence-proxy`. Click **Deploy**.
3. Click **Edit code**. Delete the sample code.
4. Paste the contents of `proxy/worker.js` from this site. Click **Deploy**.
5. Open the Worker's **Settings → Variables and Secrets**. Add a variable:
   - Name: `ALLOWED_ORIGIN`
   - Value: your site address, for example `https://USERNAME.github.io`
6. Deploy again.
7. Copy the Worker address, for example `https://cadence-proxy.USERNAME.workers.dev`.
8. In Cadence, paste it into **Proxy URL**. Click **Sync**.

The proxy only answers your own site. It only forwards to `health.googleapis.com`.

## Turning it off

- In Cadence, click **Disconnect**. This revokes the token.
- To remove access fully, open https://myaccount.google.com/permissions and remove **Cadence**.
- You can delete the Cloud project at any time.
