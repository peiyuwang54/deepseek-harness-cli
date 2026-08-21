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
#   -ReleasesUrl / DEEPSEEK_HARNESS_CLI_RELEASES_URL
#   -DownloadAttempts / DEEPSEEK_HARNESS_CLI_DOWNLOAD_ATTEMPTS
#   -DownloadTimeoutSeconds / DEEPSEEK_HARNESS_CLI_DOWNLOAD_TIMEOUT_SECONDS
#   -DownloadRetryDelaySeconds / DEEPSEEK_HARNESS_CLI_DOWNLOAD_RETRY_DELAY_SECONDS
#
# Integrity is sha256-verified against the sidecar published with the release.
# This script never clones the repository.

[CmdletBinding()]
param(
    [string]$Version = $env:DEEPSEEK_HARNESS_CLI_VERSION,
    [string]$InstallDir = $env:DEEPSEEK_HARNESS_CLI_INSTALL_DIR,
    [string]$BaseUrl = $env:DEEPSEEK_HARNESS_CLI_BASE_URL,
    [string]$ReleasesUrl = $env:DEEPSEEK_HARNESS_CLI_RELEASES_URL,
    [string]$DownloadAttempts = $env:DEEPSEEK_HARNESS_CLI_DOWNLOAD_ATTEMPTS,
    [string]$DownloadTimeoutSeconds = $env:DEEPSEEK_HARNESS_CLI_DOWNLOAD_TIMEOUT_SECONDS,
    [string]$DownloadRetryDelaySeconds = $env:DEEPSEEK_HARNESS_CLI_DOWNLOAD_RETRY_DELAY_SECONDS,
    [switch]$SkipPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Repo = "peiyuwang54/deepseek-harness-cli"
if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
    $BaseUrl = "https://github.com/$Repo/releases/download"
}
if ([string]::IsNullOrWhiteSpace($ReleasesUrl)) {
    $ReleasesUrl = "https://github.com/$Repo/releases.atom"
}
if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    $InstallDir = Join-Path $env:USERPROFILE ".deepseek-harness-cli"
}

function Write-Step {
    param([string]$Message)
    Write-Host "deepseek-harness-cli: $Message"
}

function Resolve-IntegerOption {
    param(
        [string]$Value,
        [int]$DefaultValue,
        [string]$Name,
        [int]$Minimum,
        [int]$Maximum
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $DefaultValue
    }

    $parsed = 0
    if (-not [int]::TryParse($Value, [ref]$parsed) -or $parsed -lt $Minimum -or $parsed -gt $Maximum) {
        throw "deepseek-harness-cli: $Name must be an integer from $Minimum through $Maximum."
    }
    return $parsed
}

$downloadAttemptsValue = Resolve-IntegerOption $DownloadAttempts 3 "DownloadAttempts" 1 10
$downloadTimeoutSecondsValue = Resolve-IntegerOption $DownloadTimeoutSeconds 300 "DownloadTimeoutSeconds" 1 3600
$downloadRetryDelaySecondsValue = Resolve-IntegerOption $DownloadRetryDelaySeconds 2 "DownloadRetryDelaySeconds" 0 60

function Invoke-Download {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Uri,
        [string]$OutFile
    )

    for ($attempt = 1; $attempt -le $downloadAttemptsValue; $attempt++) {
        try {
            $request = @{
                Uri = $Uri
                UseBasicParsing = $true
                TimeoutSec = $downloadTimeoutSecondsValue
            }
            if ([string]::IsNullOrWhiteSpace($OutFile)) {
                return Invoke-WebRequest @request
            }

            Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
            Invoke-WebRequest @request -OutFile $OutFile
            return
        } catch {
            if (-not [string]::IsNullOrWhiteSpace($OutFile)) {
                Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue
            }
            if ($attempt -eq $downloadAttemptsValue) {
                $message = "deepseek-harness-cli: download failed after $downloadAttemptsValue attempts: $Uri"
                throw [System.InvalidOperationException]::new($message, $_.Exception)
            }

            Write-Step "download failed ($attempt/$downloadAttemptsValue): $Uri; retrying in $downloadRetryDelaySecondsValue seconds"
            if ($downloadRetryDelaySecondsValue -gt 0) {
                Start-Sleep -Seconds $downloadRetryDelaySecondsValue
            }
        }
    }
}

function Get-Sha256 {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $sha256 = [System.Security.Cryptography.SHA256]::Create()
        try {
            return ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
        } finally {
            $sha256.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
}

if ($env:PROCESSOR_ARCHITECTURE -ne "AMD64" -and $env:PROCESSOR_ARCHITEW6432 -ne "AMD64") {
    throw "deepseek-harness-cli: unsupported architecture $($env:PROCESSOR_ARCHITECTURE); supported: Windows x64."
}

if ([string]::IsNullOrWhiteSpace($Version)) {
    # The atom feed lists releases newest-first, includes prereleases, and is not
    # subject to the unauthenticated REST rate limit that makes /releases return
    # 403 for shared or CI egress addresses.
    $tags = @()
    try {
        $feed = [xml](Invoke-Download -Uri $ReleasesUrl).Content
        $tags = @(
            $feed.feed.entry |
                ForEach-Object { ($_.link.href -split '/releases/tag/')[-1] } |
                Where-Object { $_ -like "deepseek-harness-cli-v*" }
        )
    } catch {
        $tags = @()
    }
    if ($tags.Count -eq 0) {
        # The feed is a fixed-length window, so a CLI release can age out of it
        # once other tag families publish more recently.
        $releasesResponse = Invoke-Download -Uri "https://api.github.com/repos/$Repo/releases?per_page=100"
        $releases = $releasesResponse.Content | ConvertFrom-Json
        $tags = @(
            $releases |
                ForEach-Object { $_.tag_name } |
                Where-Object { $_ -like "deepseek-harness-cli-v*" }
        )
    }
    if ($tags.Count -eq 0) {
        throw "deepseek-harness-cli: could not determine the newest release; set DEEPSEEK_HARNESS_CLI_VERSION or -Version."
    }
    $Version = $tags[0] -replace '^deepseek-harness-cli-v', ''
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
    Invoke-Download -Uri $tarballUrl -OutFile $tarball
    Invoke-Download -Uri $shaUrl -OutFile $shaFile

    $expected = ((Get-Content -LiteralPath $shaFile -Raw) -split "\s+")[0].ToLowerInvariant()
    $actual = Get-Sha256 -Path $tarball
    if ($expected -ne $actual) {
        throw "deepseek-harness-cli: checksum mismatch for $tarballUrl (expected $expected, got $actual)"
    }

    tar -xzf $tarball -C $tmp
    $exe = Join-Path $tmp "bin\deepseek-harness-cli.exe"
    if (-not (Test-Path -LiteralPath $exe)) {
        throw "deepseek-harness-cli: $tarballUrl did not contain bin/deepseek-harness-cli.exe"
    }
    $ripgrep = Join-Path $tmp "bin\deepseek-harness-cli.exe-rg"
    if (-not (Test-Path -LiteralPath $ripgrep)) {
        throw "deepseek-harness-cli: $tarballUrl did not contain bin/deepseek-harness-cli.exe-rg"
    }

    $binDir = Join-Path $InstallDir "bin"
    New-Item -ItemType Directory -Path $binDir -Force | Out-Null
    Copy-Item -LiteralPath $exe -Destination (Join-Path $binDir "deepseek-harness-cli.exe") -Force
    Copy-Item -LiteralPath $ripgrep -Destination (Join-Path $binDir "deepseek-harness-cli.exe-rg") -Force

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

Write-Step "done. Open a new terminal and run: deepseek"
