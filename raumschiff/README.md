# Raumschiff – Desktop-Haustier für Windows

Ein flacher Untertassen-Frachter mit Gabelbug, der unsichtbar in seinem Hangar unter dem Bildschirm
wartet. Steht der Mauszeiger **5 Minuten still**, fährt er auf einem **Lift von unten herauf**, startet,
**jagt den Mauszeiger und beschießt ihn mit Lasern** – und muss bei leerem Akku zurück, auf dem Lift
landen und wieder hinunter in den Hangar zum Aufladen. Gerendert mit **three.js (WebGPURenderer)**,
alle Materialien sind **TSL**-Shader: Rumpfplatten mit Fugen, Cockpitglas als Akkuanzeige,
Triebwerksbogen und Abgas, Lift mit Warnstreifen und Ladebalken, Laser, Funken, Druckwelle und Rauch.

## Ablauf

1. **Hangar** – das Fenster ist nur 1 × 1 Pixel groß und unsichtbar, es wird nichts gezeichnet;
   der Akku lädt (ca. 15 s von leer bis voll).
2. **Lift** – steht der Mauszeiger 5 Minuten still (und der Akku ist voll), wird das Fenster groß und
   der Lift fährt neben dem Mauszeiger mit Warnlichtern von unten über die Taskleiste herauf.
3. **Start** – Triebwerke laufen warm, es hebt ab und kippt dabei vom flachen Seitenprofil in die Draufsicht.
4. **Angriff** – umkreist den Mauszeiger, dreht den Bug zu ihm und feuert Salven aus je 3 Schüssen.
   Fliegen und Schießen kosten Akku; das Cockpitglas wird von cyan zu rot und flackert, wenn er knapp wird.
5. **Rückkehr** – unter 15 % fliegt es zurück, kippt ins Seitenprofil, ruft den Lift, landet darauf und
   fährt hinunter. Danach ist das Fenster wieder 1 Pixel groß, bis der Mauszeiger erneut 5 Minuten stillsteht.

## Bedienung

| Aktion | Wirkung |
| --- | --- |
| Klick auf das fliegende Schiff | Treffer! Es trudelt, raucht und muss sofort zurück |
| Tray-Symbol / Rechtsklick auf das Schiff | Menü: Jetzt starten, Zurück zur Basis, Mit Windows starten, Beenden |

Die durchsichtigen Teile des Fensters lassen Mausklicks durch – man kann also weiterarbeiten,
während man beschossen wird. Nur das Schiff selbst ist anklickbar.

## Starten

```bash
cd desktop-pets/raumschiff
npm install
npm start
```

Ohne Electron zum Ausprobieren im Browser: `npx http-server -c-1 .` im Projektordner und
`index.html?idle=5` öffnen (Wartezeit 5 s; Tasten **L** sofort starten, **B** zurück zur Basis).

## Windows-Build

```bash
npm run dist
```

Erzeugt in `dist/` eine portable `.exe` und einen Installer (electron-builder).

## Hinweise

- Fällt WebGPU aus, mit `set RAUMSCHIFF_WEBGL=1` vor `npm start` WebGL 2 erzwingen; im Browser `index.html?webgl`.
- Zum Testen die Wartezeit verkürzen: `set RAUMSCHIFF_IDLE=10` (Sekunden) vor `npm start`.
- Einstellungen (Wartezeit, Ladezeit, Lift, Verbrauch, Geschwindigkeit, Salven) stehen oben in `src/app.js`.
- Aufbau: `main.cjs` (Fenster, Tray, Mausdurchlass), `preload.cjs` (IPC-Brücke),
  `src/ship.js` (Szene + TSL-Shader), `src/app.js` (Verhalten/Flug).
