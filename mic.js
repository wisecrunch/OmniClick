// Extension popups and offscreen documents can't reliably show the microphone prompt, so it is asked for here.
const msg = document.getElementById('msg');
document.getElementById('allow').addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    msg.textContent = 'Microphone allowed. You can close this tab and start recording.';
  } catch (err) {
    msg.textContent = 'Microphone access was blocked. Allow it from the icon in the address bar, then try again.';
  }
});
