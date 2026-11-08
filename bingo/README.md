# Jackpot Jess × Wildlines — HTML game package

The complete editable game is in **Jackpot-Jess-Bingo.html**. It contains the HTML interface, CSS theme, browser JavaScript, embedded Jackpot Jess overlay and Wildlines logo, the 500-title catalogue, backend source and database schema.

## Play live

1. Install Node.js 24 or later if needed.
2. Extract this ZIP into a folder.
3. Double-click **Start Bingo.cmd** on Windows, or run `node server.mjs` from this folder.
4. Open http://localhost:4173. Keep the server window open while playing.

The small `server.mjs` launcher reads the game and rules from the HTML file and provides the shared storage needed for live players. No extra packages are required. Opening the HTML directly shows the interface as a preview; it cannot synchronize players or create live rooms without the server.

Create a room, customize the title pool, and invite players before starting. Each player receives 25 distinct titles. Only the host can draw; matches are crossed out automatically. All 25 matches are required. Players type bingo in Kick chat, and the host checks chat order and confirms an eligible winner manually. Kick usernames are self-reported; this package does not automatically read chat or award prizes.

## Edit the HTML

- The `<style>` section contains the full layout and pink-and-gold theme.
- The executable `<script>` section contains the host and player interface code.
- The final `bingo-package` JSON section contains the 500-title catalogue, backend source, and database schema. Preserve valid JSON if editing this section. You can edit or import the catalogue through the host interface instead.
- Branding images are embedded as data URLs. Slot artwork is loaded from external image hosts and requires an internet connection.

Restart the launcher after editing the HTML. Existing rooms retain the title pool they were created with; create a new room to use an edited pool. Room data is saved in the generated `data/bingo.sqlite` database and survives restarts. Keep private recovery links offered by the interface to restore host or player access.

## Share with other devices

Localhost works only on the host computer. For devices on the same network, open PowerShell in this folder and run:

```powershell
$env:HOST = '0.0.0.0'
node server.mjs
```

Open `http://YOUR-COMPUTER-LAN-IP:4173` on the host and player devices. Allow the server through Windows Firewall if prompted. Copy player links from the host page opened using that LAN address.

Internet players need the server deployed to internet-accessible hosting. Uploading only the HTML to a static website will show the interface but will not provide live synchronization. The existing live website is unchanged by this download.

This package is independent of Gamdom and Kick. It includes the game source and catalogue, not live-site rooms or player data.
