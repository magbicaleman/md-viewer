# MD Viewer

A lightweight Electron app for reading Markdown files with a minimal interface.

## Features

- Open a single Markdown file
- Open a folder and recursively scan for Markdown files
- Paste a direct path to a file or folder
- Render local images and internal Markdown links
- Adjust theme, font size, and reading width with persisted local settings

## Getting Started

```bash
npm install
npm start
```

You can also pass a file or folder path on launch:

```bash
npm start -- /absolute/path/to/notes
```

Or launch the included sample set:

```bash
npm start -- ./examples
```

## Supported Markdown Extensions

- `.md`
- `.markdown`
- `.mdown`
- `.mkd`
