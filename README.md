![Midi recorder](public/favicon.svg)

# Web MIDI Recorder

[![Deploy to GitHub Pages](https://github.com/t0mg/midi-recorder/actions/workflows/deploy.yml/badge.svg)](https://github.com/t0mg/midi-recorder/actions/workflows/deploy.yml)

A simple web-based application for recording, playing, saving, and exporting MIDI data from MIDI devices over USB.

It is useable directly from https://t0mg.github.io/midi-recorder/

## Credits

This small app was a weekend experiment made entirely on a phone using [AI studio](aistudio.google.com), [Jules](jules.google.com), and a pinch of tedious manual editing.

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
