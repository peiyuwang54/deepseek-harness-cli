/** Shell completion scripts for the `deepseek` and `dsh` launchers. */

/** Injectable output sinks for {@link runCompletion}. */
export interface CompletionCommandOptions {
  /** Receive the generated script. */
  readonly stdout?: (text: string) => void
  /** Receive usage and validation diagnostics. */
  readonly stderr?: (text: string) => void
}

const USAGE = `Usage:
  deepseek completion bash
  deepseek completion zsh
  deepseek completion fish
  deepseek completion powershell`

const BASH = String.raw`# DeepSeek Harness CLI completion for bash.
_deepseek_complete() {
  local cur prev words cword
  _init_completion -n : || return
  if [[ $cword -eq 1 ]]; then
    COMPREPLY=($(compgen -W '--help --version --yolo --full-auto --dangerously-bypass-approvals-and-sandbox --sandbox --ask-for-approval --add-dir --resume web tui exec mcp plugin doctor completion' -- "$cur"))
    return
  fi
  case "\${words[1]}" in
    mcp) COMPREPLY=($(compgen -W 'list get add enable disable remove auth tools help --help' -- "$cur"));;
    plugin) COMPREPLY=($(compgen -W '--profile list verify source enable disable install add update remove why' -- "$cur"));;
    doctor) COMPREPLY=($(compgen -W '--json --mcp-timeout-ms --help' -- "$cur"));;
    completion) COMPREPLY=($(compgen -W 'bash zsh fish powershell' -- "$cur"));;
  esac
}
complete -F _deepseek_complete deepseek dsh
`

const ZSH = String.raw`# DeepSeek Harness CLI completion for zsh.
_deepseek() {
  _arguments -C \
    '1:command:(web tui exec mcp plugin doctor completion)' \
    '*::argument:->args'
  case $words[2] in
    mcp) _values 'MCP command' list get add enable disable remove auth tools help ;;
    plugin) _values 'plugin command' list verify source enable disable install add update remove ;;
    doctor) _values 'doctor option' --json --mcp-timeout-ms --help ;;
    completion) _values 'shell' bash zsh fish powershell ;;
  esac
}
compdef _deepseek deepseek
compdef _deepseek dsh
`

const FISH = String.raw`# DeepSeek Harness CLI completion for fish.
complete -c deepseek -f -n '__fish_use_subcommand' -a 'web tui exec mcp plugin doctor completion' -d 'DeepSeek Harness command'
complete -c dsh -f -n '__fish_use_subcommand' -a 'web tui exec mcp plugin doctor completion' -d 'DeepSeek Harness command'
complete -c deepseek -f -n '__fish_seen_subcommand_from doctor' -a '--json --mcp-timeout-ms --help'
complete -c dsh -f -n '__fish_seen_subcommand_from doctor' -a '--json --mcp-timeout-ms --help'
complete -c deepseek -f -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish powershell'
complete -c dsh -f -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish powershell'
complete -c deepseek -f -n '__fish_seen_subcommand_from mcp' -a 'list get add enable disable remove auth tools help'
complete -c dsh -f -n '__fish_seen_subcommand_from mcp' -a 'list get add enable disable remove auth tools help'
complete -c deepseek -f -n '__fish_seen_subcommand_from plugin' -a 'list verify source enable disable install add update remove'
complete -c dsh -f -n '__fish_seen_subcommand_from plugin' -a 'list verify source enable disable install add update remove'
`

const POWERSHELL = String.raw`# DeepSeek Harness CLI completion for PowerShell.
Register-ArgumentCompleter -Native -CommandName deepseek,dsh -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $commands = @('web','tui','exec','mcp','plugin','doctor','completion')
  $options = @('--help','--version','--yolo','--full-auto','--sandbox','--ask-for-approval','--add-dir','--resume')
  $tokens = $commandAst.CommandElements | ForEach-Object { $_.ToString() }
  $values = if ($tokens.Count -le 1) { $commands + $options } elseif ($tokens[1] -eq 'completion') { @('bash','zsh','fish','powershell') } elseif ($tokens[1] -eq 'doctor') { @('--json','--mcp-timeout-ms','--help') } elseif ($tokens[1] -eq 'mcp') { @('list','get','add','enable','disable','remove','auth','tools','help') } elseif ($tokens[1] -eq 'plugin') { @('list','verify','source','enable','disable','install','add','update','remove') } else { @() }
  $values | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }
}
`

const SCRIPTS: Readonly<Record<string, string>> = {
  bash: BASH,
  zsh: ZSH,
  fish: FISH,
  powershell: POWERSHELL,
}

/**
 * Print a completion script for one supported shell.
 * @param args - arguments after `completion`.
 * @param options - output sinks used by the launcher and tests.
 * @returns zero on success and one for usage errors.
 */
export function runCompletion(args: readonly string[], options: CompletionCommandOptions = {}): number {
  const stdout = options.stdout ?? ((text) => { process.stdout.write(text) })
  const stderr = options.stderr ?? ((text) => { process.stderr.write(text) })
  if (args.length !== 1 || SCRIPTS[args[0] as string] === undefined) {
    stderr(`dsh completion: expected one of bash, zsh, fish, powershell\n${USAGE}\n`)
    return 1
  }
  stdout(SCRIPTS[args[0] as string] as string)
  return 0
}
