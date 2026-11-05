# Prerequisites and keeping the data private

The user may know nothing about git, GitHub or Node. Run the checks yourself, act on what they show, and talk in plain words (Plain words in CLAUDE.md): "this folder", "this computer", "online", "public" and "private". Ask only what the user can answer.

Run these and keep the results to yourself until a bullet below says what to tell the user:

```sh
node --version                      # needs ^24.11 or >=26 (package.json engines)
# On a Mac without developer tools, plain `git` opens an install dialog; the guard skips it.
if command -v git >/dev/null && { [ "$(uname)" != Darwin ] || xcode-select -p >/dev/null 2>&1; }; then
  git rev-parse --show-toplevel; git remote get-url origin   # no origin: the folder lives only on this computer
else echo "no git"; fi
ls -d "${NVM_DIR:-$HOME/.nvm}" 2>/dev/null; command -v fnm volta brew   # which Node managers exist
for p in "${CHROME_PATH:-}" "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" /usr/bin/google-chrome /usr/bin/google-chrome-stable /usr/bin/chromium /usr/bin/chromium-browser; do [ -n "$p" ] && [ -x "$p" ] && echo "chrome: $p" && break; done
command -v pdftotext pdfinfo
```

For a GitHub `origin` that is not the engine, check it without `gh` or a login: `curl -s -o /dev/null -w '%{http_code}' https://api.github.com/repos/<owner>/<name>` answers 200 for a public repository and 404 for a private one (or one that does not exist).

- Node missing, or outside the range (Node 25 is outside it too): install or switch it yourself, and continue onboarding once it is in range. Tell the user one line ("The coach needs a newer version of a program it runs on; I'm installing it now."); the version and the tool are your choice, never a question. Each shell command starts fresh, so load the manager in the same command as the step that needs it. Use the first manager the check found:
  - nvm: `. "${NVM_DIR:-$HOME/.nvm}/nvm.sh" && nvm install && nvm alias default "$(cat .nvmrc)"` (it reads `.nvmrc`).
  - fnm: `eval "$(fnm env)" && fnm install && fnm default "$(cat .nvmrc)"`.
  - volta: `volta install node@"$(cat .nvmrc)"`.
  - Homebrew: `brew upgrade node`, or `brew install node` when Homebrew has none.
  - None, on macOS: download `https://nodejs.org/dist/v<version>/node-v<version>.pkg` (version from `.nvmrc`) into a scratch folder outside this one. The installer needs the user's computer password, so hand over exactly one line with its reason: "This step asks for your computer password, so it has to be typed by you: `! sudo installer -pkg <path> -target /`".
  - None, on Linux or WSL: download `node-v<version>-linux-x64.tar.xz` (`linux-arm64` when `uname -m` says `aarch64`) from the same place, unpack it into `$HOME/.local/node`, and add `export PATH="$HOME/.local/node/bin:$PATH"` to the shell's startup file (`~/.bashrc` or `~/.zshrc`). No password is needed.

  Then check in a fresh command: `node --version` must be in range. If an old version still shows, `which -a node` lists every copy; the first one is hiding the new one. Fix the order yourself (the manager's default, or the new folder first on the path in the startup file) and check again. Finally run `npm ci` to install the coach's own tools. It takes a minute or two, so say first, in these words: "I'm setting up the coach now, which takes a minute or two."
- No git (the check printed `no git`), or `git rev-parse --show-toplevel` names a folder other than this one: this folder keeps no history, and the coach saves nothing beyond the files themselves. Say nothing about it, never suggest installing anything for it, and skip the bullets about the online copy.
- No `origin`: the data stays on this computer. Tell the user that in one line; nothing to ask.
- `origin` is `leonardoazeredo/job-coach` (copied straight from the public project): nobody else's data can reach it, but unlink it so nothing ever can. Say: "This folder was copied from the public project online. I'll unlink it so what you add here stays on this computer; updates to the coach still work." On a yes, run `git remote rename origin upstream`; the update-coach skill finds the engine under that name.
- Any other `origin` that answers 200 (public): stop and say plainly that this folder is linked to a public page online, where anything saved could be seen by anyone, and that nothing personal goes in until that is fixed. If the user made it with **Use this template**, `gh repo edit --visibility private --accept-visibility-change-consequences` (or the repository's Settings page) makes it private; a fork cannot be made private, so the user starts again from the template, or unlinks with `git remote rename origin public-copy` and keeps the data local.
- `origin` answers 404, or is not on GitHub: say the online copy is private or cannot be checked, and ask one plain question: "Is the online copy of this folder set to private, or would you rather keep everything on this computer?" Keeping it local means `git remote rename origin unused-online-copy` after a yes.
- No Chrome or no poppler is a warning, not a stop: only PDF export needs them, and it is optional and can be set up later. A PDF CV can still be imported in step 2 without poppler. Offer to install them, and on a yes run the install yourself: `brew install --cask google-chrome` and `brew install poppler` on macOS. On Debian or Ubuntu, `sudo apt install chromium poppler-utils` needs the computer password, so it goes to the user as one `! ` line with that reason. Elsewhere, set `CHROME_PATH` to a Chrome program the user already has.
