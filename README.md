# grow2 prototype

## Try it

### Locally

```
# Local (uses files from your computer)
npm start
```

### GitHub

Reads files from [https://github.com/jeremydw/grow2-prototype](https://github.com/jeremydw/grow2-prototype).

Just visit [https://grow2-prototype-dot-grow-prod.appspot.com/](https://grow2-prototype-dot-grow-prod.appspot.com/).

## Notes

- Implements client-side page rendering.
- Resolves YAML and templates in-browser.
- Implements basic routing.
- Stubs for gettext.
- No CI needed! It reads files live from the HEAD of the repo.

## What else to prototype

- First party objects for text (i.e. `!g.text`).
- Node-based implementation of `grow build` equivalent (on CLI).
- Localization (i.e. localized routing, text translation).
- Localization in YAML (do we do this with `@<locale>` again?)
- Listing directories. Not sure if we can do this without a proxy between the app and GitHub.
