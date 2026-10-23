# OmniClick 2.2.3

A toolbox of small click-saving features for Chrome, currently focused on Gmail.

[Homepage](https://wisecrunch.github.io/OmniClick/) · [Privacy policy](https://wisecrunch.github.io/OmniClick/privacy.html) · [Terms of service](https://wisecrunch.github.io/OmniClick/terms.html) · [Support](https://github.com/wisecrunch/OmniClick/issues)

## Install from source

Download this repository as a ZIP and extract it, or clone it. Open `chrome://extensions`,
enable Developer mode, choose **Load unpacked**, and select the folder containing
`manifest.json`. Refresh Gmail and use OmniClick's popup to enable the features you want.
Local notes work without a Google Cloud project. Drive sync needs the setup below.

## Website and publishing

The static homepage and policy pages are in `docs/`. GitHub Pages publishes the `main`
branch's `/docs` directory at https://wisecrunch.github.io/OmniClick/. There is no build
step, analytics script, or custom domain. Edit those files and push to `main` to update
the site. Website publishing does not complete Google OAuth verification.

The public manifest includes OmniClick's OAuth client ID and the limited `drive.file`
scope. A client ID is public app configuration; it is not a client secret and does not
grant access to a Google account. Never commit private keys, client secrets, access or
refresh tokens, note exports, or browser data.

The bundled OAuth client works only with the extension ID registered for it in Google
Cloud. Unpacked installations with a different extension ID, and forks using their own
Google Cloud project, must configure a matching Chrome Extension OAuth client using
the Drive setup screen or `configure-drive.ps1`. Adding the client ID does not complete
Google's OAuth verification or bypass user consent.

## Private Gmail notes

Reload OmniClick at `chrome://extensions` (or `edge://extensions`), refresh Gmail,
then switch on **Private Gmail notes** in OmniClick's popup. Both features use the same toggle style.

Empty conversations show an icon-only **Add note** button beside Gmail's **Print all**
and **In new window** controls, with a circular gray hover effect. Click it to open and
focus the editor; click again to collapse. If Gmail's toolbar is unavailable, the icon
sits beside the subject. Existing notes open expanded automatically. The refreshed
card supports light/dark surfaces and narrow layouts. Text saves automatically;
you can change its color, mark it done, collapse it, or delete it. Inbox rows show
a short preview when Gmail exposes the thread identifier. **All notes** opens search,
account/status filters and JSON backup export/import. The popup has the same shortcut.
Disabling notes removes the editor and previews without deleting saved notes.

Notes are stored in `chrome.storage.local`, separately by mailbox email and thread ID.
They are not sent with email. Google Drive sync is optional; see below. Gmail mobile
does not run this desktop extension. Export a backup before uninstalling the extension.
Imports keep newer local notes. Gmail may change its page structure; if its mailbox or
thread cannot be identified, OmniClick leaves the editor hidden.

The existing Gmail audio player remains independently configurable.

## Google sign-in and visible Drive sync (Chrome)

1. In the popup choose **Google Drive sync**. The setup section shows this installation's
   extension ID and whether an OAuth client is configured.
   The bundled client ID is already configured; if this installation's ID matches its
   Google Cloud registration, click **Connect Google Drive** and complete consent.
   The remaining setup steps are for configuring a different installation or your own client.
2. In your Google Cloud project, enable Google Drive API and configure Google Auth
   Platform branding/audience. If in Testing, add your account to test users.
3. Create a **Chrome Extension** OAuth client (formerly called Chrome App), using the
   extension ID displayed in setup as the Item ID. A Web application client is not suitable.
4. Add the non-sensitive scope `https://www.googleapis.com/auth/drive.file` to Data Access.
5. Supply the client ID using the setup page's configured-manifest download. Replace the
   manifest in this extension folder and reload. Alternatively, from PowerShell run:

   `& .\configure-drive.ps1 -ClientId 'YOUR_CLIENT_ID.apps.googleusercontent.com'`

6. Reload OmniClick in `chrome://extensions`, refresh Gmail, reopen Drive sync, and click
   **Connect Google Drive**. Accept Google's requested file access. Approve any new
   extension permissions Chrome presents after the update.

No client secret or Google password is stored. Chrome manages OAuth access tokens.
The extension requests access only to files created/opened with OmniClick, not all Drive.
Sign-in uses Chrome's profile account. The connection screen identifies the Drive mailbox;
only notes whose mailbox matches that address upload. Other accounts' notes remain local.

The visible folder contains:

- `OmniClick Notes/Notes`: current notes as readable JSON, including mailbox, thread,
  subject, note text, color, completion status, timestamp and deletion marker.
- `OmniClick Notes/Backups`: saved versions, created before a current file is overwritten.

Notes save locally immediately. Sync runs about four seconds after local edits stop,
every five minutes while Chrome runs, on startup, or with **Sync now**. Failed uploads
leave local notes intact and retry later. The Drive screen reports sync errors and counts.
Disconnect stops sync and keeps both local notes and Drive files. Turning off the notes
feature hides Gmail's controls; disconnect Drive separately to stop syncing.

Use **Saved versions** in Drive settings to restore a previous note. Restoration creates
a fresh version and syncs it. Conflicting versions are archived; the newest note timestamp
wins (with a deterministic tie break). Keep computer clocks correct. History is retained
until its files are manually deleted from Drive and uses your normal Drive storage.
JSON backup export/import remains available independently of Drive.

Delete notes inside OmniClick to propagate deletions: a small tombstone record prevents
another computer from uploading an old copy again. Earlier text remains in Backups.
Drive files are managed by the extension. Directly removing a current file in Drive does
not delete local notes; it can be recreated. Direct JSON edits are not a supported editor.

On another computer, install OmniClick, configure an OAuth client in the same Google Cloud
project for that installation's extension ID, and connect the same Google account.
An unpacked extension's ID depends on its folder path unless a public manifest `key`
is present. For a single portable ID, distribute the same store extension or a package
with a fixed public key. Export notes before changing the extension ID; Chrome treats
different IDs as separate extensions and stores their local data separately.

References:
- https://developer.chrome.com/docs/extensions/how-to/integrate/oauth
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/workspace/drive/api/guides/manage-uploads
