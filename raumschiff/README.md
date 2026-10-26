# Raumschiff – Desktop-Haustier für Windows

Eine kleine Retro-Rakete, die auf ihrem Startplatz an der Taskleiste lädt, hin und wieder startet,
den **Mauszeiger jagt und mit Lasern beschießt** – und bei leerem Akku zurückfliegt, landet und
wieder auflädt. Gerendert mit **three.js (WebGPURenderer)**, alle Materialien sind **TSL**-Shader:
Rumpf mit Comic-Licht, Bullauge als Akkuanzeige, flackernde Triebwerksflamme, Ladebalken am
Startplatz, Laser, Funken, Druckwelle und Rauch.

## Ablauf

1. **Laden** – steht auf dem Startplatz, der Ladebalken füllt sich (ca. 15 s von leer bis voll).
2. **Start** – vollgeladen wartet es zufällig 8–40 s, dann hebt es senkrecht ab (Rauch am Boden).
3. **Angriff** – umkreist den Mauszeiger, dreht die Nase zu ihm und feuert Salven aus je 3 Schüssen.
   Fliegen und Schießen kosten Akku; das Bullauge wird von cyan zu rot und flackert, wenn er knapp wird.
4. **Rückflug & Landung** – unter 15 % fliegt es zurück, richtet sich auf und setzt sanft auf.

## Bedienung

| Aktion | Wirkung |
| --- | --- |
| Klick auf das fliegende Schiff | Treffer! Es trudelt, raucht und muss sofort zurück zur Basis |
| Klick auf das geladene Schiff am Boden | startet sofort |
| Rechtsklick / Tray-Symbol | Menü: Jetzt starten, Zurück zur Basis, Startplatz hierher, Mit Windows starten, Beenden |

Die durchsichtigen Teile des Fensters lassen Mausklicks durch – man kann also weiterarbeiten,
während man beschossen wird. Nur das Schiff selbst ist anklickbar.

## Starten

```bash
cd desktop-pets/raumschiff
npm install
npm start
```

Ohne Electron zum Ausprobieren im Browser: `npx http-server -c-1 .` im Projektordner und
`index.html` öffnen (Tasten **L** starten, **B** zurück zur Basis, **H** Startplatz zum Mauszeiger).

## Windows-Build

```bash
npm run dist
```

Erzeugt in `dist/` eine portable `.exe` und einen Installer (electron-builder).

## Hinweise

- Fällt WebGPU aus, mit `set RAUMSCHIFF_WEBGL=1` vor `npm start` WebGL 2 erzwingen; im Browser `index.html?webgl`.
- Einstellungen (Ladezeit, Startpause, Verbrauch, Geschwindigkeit, Salven) stehen oben in `src/app.js`.
- Aufbau: `main.cjs` (Fenster, Tray, Mausdurchlass), `preload.cjs` (IPC-Brücke),
  `src/ship.js` (Szene + TSL-Shader), `src/app.js` (Verhalten/Flug).
