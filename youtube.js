// YouTube upload with the user's own Google OAuth client (implicit flow via chrome.identity).
const YouTube = (() => {
  const SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
  let cached = null; // { token, expires }

  async function getClientId() {
    const { ytClientId = '' } = await chrome.storage.sync.get('ytClientId');
    return ytClientId.trim();
  }

  async function getToken() {
    if (cached && cached.expires > Date.now() + 60_000) return cached.token;
    const clientId = await getClientId();
    if (!clientId) throw new Error('Add your Google OAuth Client ID under "YouTube setup" first.');
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: clientId,
      response_type: 'token',
      redirect_uri: chrome.identity.getRedirectURL(),
      scope: SCOPE,
    });
    const redirect = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
    const params = new URLSearchParams(new URL(redirect).hash.slice(1));
    const token = params.get('access_token');
    if (!token) throw new Error(params.get('error') || 'Google sign-in did not return a token.');
    cached = { token, expires: Date.now() + Number(params.get('expires_in') || 3600) * 1000 };
    return token;
  }

  // Resumable upload: create the session with metadata, then PUT the file (with progress).
  async function upload(blob, { title, description, privacy }, onProgress) {
    const token = await getToken();
    const type = blob.type.split(';')[0] || 'video/mp4';
    const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(blob.size),
        'X-Upload-Content-Type': type,
      },
      body: JSON.stringify({
        snippet: { title, description, categoryId: '22' },
        status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
      }),
    });
    if (!init.ok) throw new Error(await errorText(init));
    const location = init.headers.get('Location');
    if (!location) throw new Error('YouTube did not return an upload address.');

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', location);
      xhr.setRequestHeader('Content-Type', type);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
        else reject(new Error(`YouTube upload failed (${xhr.status}) ${xhr.responseText.slice(0, 200)}`));
      };
      xhr.onerror = () => reject(new Error('Network error during upload.'));
      xhr.send(blob);
    });
  }

  async function errorText(resp) {
    try {
      const j = await resp.json();
      return (j.error && j.error.message) || `HTTP ${resp.status}`;
    } catch (err) {
      return `HTTP ${resp.status}`;
    }
  }

  return { upload, getClientId };
})();
