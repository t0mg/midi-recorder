![Midi recorder](public/favicon.svg)

# Web MIDI Recorder

[![Deploy to GitHub Pages](https://github.com/t0mg/midi-recorder/actions/workflows/deploy.yml/badge.svg)](https://github.com/t0mg/midi-recorder/actions/workflows/deploy.yml)

A simple web-based application for recording, playing, saving, and exporting MIDI data from MIDI devices over USB.

It is useable directly from https://t0mg.github.io/midi-recorder/

## Credits

This small app was a weekend experiment made entirely on a phone using [AI studio](aistudio.google.com), [Jules](jules.google.com), and a pinch of tedious manual editing.

The icon is a simplified version of the [Roland TR-808](https://en.wikipedia.org/wiki/Roland_TR-808) start/stop button.

The application icon is provided in multiple formats to ensure it looks good on all platforms. This includes a maskable icon for Android devices, which prevents the icon from being cropped or displayed in a white circle.

## Features

- Connect to MIDI input and output devices.
- Record MIDI performances.
- Playback recorded MIDI data.
- Save recordings in the browser's local storage.
- Export recordings as MIDI files (`.mid`).
- Import MIDI files.
- Auto-record on MIDI input.

## How to build and run

This project uses [Vite](https://vitejs.dev/) for development and building.

To run the app in development mode:

```bash
npm install
npm run dev
```

To create a production build:

```bash
npm install
npm run build
```

To preview the production build:

```bash
npm run preview
```

## License

This project is licensed under the Apache License, Version 2.0. See the `LICENSE` file for details.
