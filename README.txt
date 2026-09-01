HERNE EISDISCO – HEV WUNSCHBOX + SPOTIFY BROWSER CONTROL ROOM

Render:
Build Command: npm install
Start Command: npm start

Environment Variables:
ADMIN_PASSWORD=0000
PORT=10000
SPOTIFY_CLIENT_ID=deine Spotify Client ID
SPOTIFY_CLIENT_SECRET=dein Spotify Client Secret
SPOTIFY_REDIRECT_URI=https://DEINE-RENDER-URL.onrender.com/auth/spotify/callback

Spotify setup:
1. In Spotify for Developers, create/edit the app and enable Web Playback SDK / Web API as applicable.
2. Add EXACTLY the Redirect URI above to the Spotify app allowlist.
3. Put Client ID and Client Secret only in Render Environment Variables, never in HTML/JS.
4. Deploy.
5. Open the website -> Control Room -> password 0000 -> SPOTIFY VERBINDEN.
6. Sign in with the DJ's Spotify Premium account and allow the requested permissions.
7. Return to the Control Room and press WUNSCHLISTE STARTEN.

How playback works:
- Visitors do NOT need Spotify Premium. They search Spotify and send track IDs into the public queue.
- The DJ's browser runs Spotify Web Playback SDK and becomes a Spotify Connect device.
- The server uses the DJ's OAuth refresh token to control that browser device.
- The Control Room automatically advances to the next accepted/pending Spotify request when the current track ends.
- Birthday requests still use the local birthday.mp3 and are played in the same queue.

Important:
Spotify requires Premium for Web Playback SDK playback. Spotify's platform also has restrictions on commercial streaming and broadcasting; review Spotify's current Developer Terms before using this publicly/commercially.
