# Shell completion

`wlz completion SHELL` prints a completion script for bash, zsh, fish, PowerShell, or Nushell. With the script installed, Tab completes the commands of `wlz`, their options, the bumps, and the directory of `-C`.

The script asks `wlz` for the suggestions on every Tab, so `wlz` must be on your `PATH`. After you update wandelzeug, run the install command again, because the script itself can change.

## Bash

The script needs [bash-completion](https://github.com/scop/bash-completion) 2. To install the script where bash-completion loads it on demand, run the following commands:

```sh
mkdir -p ~/.local/share/bash-completion/completions
wlz completion bash > ~/.local/share/bash-completion/completions/wlz
```

If you set `XDG_DATA_HOME`, use `$XDG_DATA_HOME/bash-completion/completions` instead. New shells complete `wlz` right away.

## zsh

To install the script as `_wlz` in a directory of your own, such as `~/.zfunc`, run the following commands:

```sh
mkdir -p ~/.zfunc
wlz completion zsh > ~/.zfunc/_wlz
```

Then add the directory to `fpath` in `~/.zshrc`, before `compinit` runs:

```zsh
fpath=(~/.zfunc $fpath)
autoload -Uz compinit && compinit
```

## fish

To install the script where fish looks for completions, run the following commands:

```sh
mkdir -p ~/.config/fish/completions
wlz completion fish > ~/.config/fish/completions/wlz.fish
```

fish loads the script the first time you complete `wlz`.

## PowerShell

To save the script next to your profile, run the following command:

```powershell
wlz completion pwsh > (Join-Path (Split-Path $PROFILE) wlz-completion.ps1)
```

Then add the following line to your profile, which `$PROFILE` names:

```powershell
. (Join-Path (Split-Path $PROFILE) wlz-completion.ps1)
```

## Nushell

To save the script in your configuration directory, run the following command:

```nu
wlz completion nu | save --force ($nu.default-config-dir | path join wlz-completion.nu)
```

Then add the following line to `config.nu`:

```nu
source ($nu.default-config-dir | path join wlz-completion.nu)
```
