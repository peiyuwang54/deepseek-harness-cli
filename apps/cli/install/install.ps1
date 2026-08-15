# deepseek-harness-cli Windows installer — download the win-x64 single-file
# executable from the deepseek-harness-cli-v* GitHub Releases of
# peiyuwang54/deepseek-harness-cli.
#
#   irm https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/apps/cli/install/install.ps1 | iex
#   powershell -ExecutionPolicy Bypass -File .\apps\cli\install\install.ps1 -Version 0.1.0-rc.5
#
# Overrides (parameter or environment):
#   -Version / DEEPSEEK_HARNESS_CLI_VERSION
#   -InstallDir / DEEPSEEK_HARNESS_CLI_INSTALL_DIR
#   -BaseUrl / DEEPSEEK_HARNESS_CLI_BASE_URL
#
# Integrity is sha256-verified against the sidecar published with the release.
# This script never clones the repository.

[CmdletBinding()]
param(
    [string]$Version = $env:DEEPSEEK_HARNESS_CLI_VERSION,
    [string]$InstallDir = $env:DEEPSEEK_HARNESS_CLI_INSTALL_DIR,
    [string]$BaseUrl = $env:DEEPSEEK_HARNESS_CLI_BASE_URL,
    [switch]$SkipPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Repo = "peiyuwang54/deepseek-harness-cli"
if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
    $BaseUrl = "https://github.com/$Repo/releases/download"
}
if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    $InstallDir = Join-Path $env:USERPROFILE ".deepseek-harness-cli"
}

function Write-Step {
    param([string]$Message)
    Write-Host "deepseek-harness-cli: $Message"
}

if ($env:PROCESSOR_ARCHITECTURE -ne "AMD64" -and $env:PROCESSOR_ARCHITEW6432 -ne "AMD64") {
    throw "deepseek-harness-cli: unsupported architecture $($env:PROCESSOR_ARCHITECTURE); supported: Windows x64."
}

if ([string]::IsNullOrWhiteSpace($Version)) {
    $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases?per_page=100"
    $match = @(
        $releases |
            ForEach-Object { $_.tag_name } |
            Where-Object { $_ -like "deepseek-harness-cli-v*" }
    )
    if ($match.Count -eq 0) {
        throw "deepseek-harness-cli: could not determine the newest release; set DEEPSEEK_HARNESS_CLI_VERSION or -Version."
    }
    $Version = $match[0] -replace '^deepseek-harness-cli-v', ''
}

$Version = $Version.TrimStart("v")
$asset = "deepseek-harness-cli-x64-win"
$releaseUrl = "$BaseUrl/deepseek-harness-cli-v$Version"
$tarballUrl = "$releaseUrl/$asset.tar.gz"
$shaUrl = "$releaseUrl/$asset.sha256"

Write-Step "installing deepseek-harness-cli $Version for win-x64"

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("dsh-install-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    $tarball = Join-Path $tmp "deepseek-harness-cli.tar.gz"
    $shaFile = Join-Path $tmp "deepseek-harness-cli.tar.gz.sha256"
    Invoke-WebRequest -Uri $tarballUrl -OutFile $tarball -UseBasicParsing
    Invoke-WebRequest -Uri $shaUrl -OutFile $shaFile -UseBasicParsing

    $expected = ((Get-Content -LiteralPath $shaFile -Raw) -split "\s+")[0].ToLowerInvariant()
    $actual = (Get-FileHash -LiteralPath $tarball -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($expected -ne $actual) {
        throw "deepseek-harness-cli: checksum mismatch for $tarballUrl (expected $expected, got $actual)"
    }

    tar -xzf $tarball -C $tmp
    $exe = Join-Path $tmp "bin\deepseek-harness-cli.exe"
    if (-not (Test-Path -LiteralPath $exe)) {
        throw "deepseek-harness-cli: $tarballUrl did not contain bin/deepseek-harness-cli.exe"
    }

    $binDir = Join-Path $InstallDir "bin"
    New-Item -ItemType Directory -Path $binDir -Force | Out-Null
    Copy-Item -LiteralPath $exe -Destination (Join-Path $binDir "deepseek-harness-cli.exe") -Force

    $launcher = @"
@echo off
"%~dp0deepseek-harness-cli.exe" %*
"@
    Set-Content -LiteralPath (Join-Path $binDir "dsh.cmd") -Value $launcher -Encoding ascii
    Set-Content -LiteralPath (Join-Path $binDir "deepseek.cmd") -Value $launcher -Encoding ascii

    Write-Step "installed to $binDir\deepseek-harness-cli.exe"

    if (-not $SkipPath) {
        $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if ($null -eq $userPath) { $userPath = "" }
        $needle = $binDir.TrimEnd("\")
        $already = $userPath.Split(";", [System.StringSplitOptions]::RemoveEmptyEntries) |
            Where-Object { $_.TrimEnd("\") -ieq $needle }
        if (-not $already) {
            $joined = if ([string]::IsNullOrWhiteSpace($userPath)) { $binDir } else { "$userPath;$binDir" }
            [Environment]::SetEnvironmentVariable("Path", $joined, "User")
            Write-Step "added $binDir to the user PATH"
        }
    }
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Step "done. Open a new terminal and run: deepseek-harness-cli tui"
