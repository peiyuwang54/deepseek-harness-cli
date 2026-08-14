# Requires a git checkout of this repository. Builds the Windows directory
# package from that checkout, copies it to %LOCALAPPDATA%\Programs\dsh, and
# adds that folder to the user PATH. There is no download URL: this script
# never fetches a remote payload.
#
#   git clone <this-repo>
#   cd <this-repo>
#   powershell -ExecutionPolicy Bypass -File .\scripts\install\install.ps1

[CmdletBinding()]
param(
    [string]$InstallDir = $env:DSH_INSTALL_DIR,
    [string]$PackageDir = "",
    [switch]$SkipPack,
    [switch]$SkipBuild,
    [switch]$SkipZip,
    [switch]$SkipPath,
    [switch]$SkipVerify,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$NonInteractive = $env:DSH_NON_INTERACTIVE -match "^(?i:1|true|yes)$"

function Write-Step {
    param([string]$Message)
    Write-Host "==> $Message"
}

function Write-WarningStep {
    param([string]$Message)
    Write-Warning $Message
}

function Path-Contains {
    param(
        [string]$PathValue,
        [string]$Entry
    )

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return $false
    }

    $needle = $Entry.TrimEnd("\")
    foreach ($segment in $PathValue.Split(";", [System.StringSplitOptions]::RemoveEmptyEntries)) {
        if ($segment.TrimEnd("\") -ieq $needle) {
            return $true
        }
    }

    return $false
}

function Add-PathEntry {
    param(
        [string]$PathValue,
        [string]$Entry
    )

    if (Path-Contains -PathValue $PathValue -Entry $Entry) {
        return $PathValue
    }

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return $Entry
    }

    return "$PathValue;$Entry"
}

function Invoke-WithInstallLock {
    param(
        [string]$LockPath,
        [scriptblock]$Script
    )

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LockPath) | Out-Null
    $lock = $null
    while ($null -eq $lock) {
        try {
            $lock = [System.IO.File]::Open(
                $LockPath,
                [System.IO.FileMode]::OpenOrCreate,
                [System.IO.FileAccess]::ReadWrite,
                [System.IO.FileShare]::None
            )
        } catch [System.IO.IOException] {
            Start-Sleep -Milliseconds 250
        }
    }
    try {
        & $Script
    } finally {
        $lock.Dispose()
    }
}

function Resolve-RepoRoot {
    $scriptDir = $PSScriptRoot
    if ([string]::IsNullOrWhiteSpace($scriptDir)) {
        throw "install.ps1 must be run from a file path so it can find the repository root."
    }

    $candidate = (Resolve-Path (Join-Path $scriptDir "..\..")).Path
    $workspace = Join-Path $candidate "pnpm-workspace.yaml"
    $cliManifest = Join-Path $candidate "apps\cli\package.json"
    $packer = Join-Path $candidate "scripts\pack-windows-cli.ts"
    if (-not (Test-Path -LiteralPath $workspace) -or -not (Test-Path -LiteralPath $cliManifest) -or -not (Test-Path -LiteralPath $packer)) {
        throw "install.ps1 must run from a DeepSeek Harness checkout. Missing $workspace, $cliManifest, or $packer."
    }

    return $candidate
}

function Test-NodeVersion {
    $raw = (& node -p "process.versions.node" 2>$null)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($raw)) {
        throw "install.ps1 requires Node.js ^22.19.0 or >=24.0.0 on PATH. Install Node, then re-run."
    }

    $parts = $raw.Trim().Split(".")
    if ($parts.Length -lt 2) {
        throw "install.ps1 could not parse Node.js version $raw."
    }

    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    if ($major -eq 22 -and $minor -ge 19) {
        return $raw.Trim()
    }
    if ($major -ge 24) {
        return $raw.Trim()
    }

    throw "install.ps1 requires Node.js ^22.19.0 or >=24.0.0; found $raw."
}

function Assert-Pnpm {
    $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
    if ($null -ne $pnpm) {
        return
    }

    $corepack = Get-Command corepack -ErrorAction SilentlyContinue
    if ($null -eq $corepack) {
        throw "install.ps1 requires pnpm 11.7.0. Enable Corepack (corepack enable) or install pnpm, then re-run."
    }

    Write-Step "Activating pnpm through Corepack"
    if ($DryRun) {
        Write-Host "==> [dry-run] corepack enable"
        Write-Host "==> [dry-run] corepack prepare pnpm@11.7.0 --activate"
        return
    }

    & corepack enable
    if ($LASTEXITCODE -ne 0) {
        throw "install.ps1: corepack enable failed."
    }
    & corepack prepare pnpm@11.7.0 --activate
    if ($LASTEXITCODE -ne 0) {
        throw "install.ps1: corepack prepare pnpm@11.7.0 --activate failed."
    }
}

function Copy-PackageTree {
    param(
        [string]$Source,
        [string]$Destination
    )

    # Copy-Item hits MAX_PATH on nested node_modules; robocopy copies those names.
    if (Test-Path -LiteralPath $Destination) {
        Remove-Item -LiteralPath $Destination -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    & robocopy $Source $Destination /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP
    if ($LASTEXITCODE -ge 8) {
        throw "install.ps1: robocopy failed with exit code $LASTEXITCODE while copying $Source to $Destination."
    }
}

function Test-PackageComplete {
    param([string]$Dir)

    $required = @(
        "node.exe",
        "dsh.cmd",
        "lib\bin.js",
        "dsh-install.json",
        "package.json"
    )
    foreach ($name in $required) {
        if (-not (Test-Path -LiteralPath (Join-Path $Dir $name) -PathType Leaf)) {
            return $false
        }
    }
    return $true
}

if ($env:OS -ne "Windows_NT") {
    Write-Error "install.ps1 supports Windows only."
    exit 1
}

if (-not [Environment]::Is64BitOperatingSystem) {
    Write-Error "dsh requires a 64-bit version of Windows."
    exit 1
}

$architecture = $env:PROCESSOR_ARCHITECTURE
if ($architecture -notin @("AMD64", "ARM64")) {
    Write-Error "Unsupported architecture: $architecture. dsh supports AMD64 and ARM64."
    exit 1
}

$repoRoot = Resolve-RepoRoot
if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    $InstallDir = Join-Path $env:LOCALAPPDATA "Programs\dsh"
}
if ([string]::IsNullOrWhiteSpace($PackageDir)) {
    $PackageDir = Join-Path $repoRoot "dist-windows\dsh"
}

if (-not $SkipPack) {
    $nodeVersion = Test-NodeVersion
    Write-Step "Detected Node.js $nodeVersion"
    Assert-Pnpm

    $nodeModules = Join-Path $repoRoot "node_modules"
    if (-not (Test-Path -LiteralPath $nodeModules)) {
        Write-Step "Installing workspace dependencies"
        if ($DryRun) {
            Write-Host "==> [dry-run] pnpm install --frozen-lockfile"
        } else {
            Push-Location $repoRoot
            try {
                & pnpm install --frozen-lockfile
                if ($LASTEXITCODE -ne 0) {
                    throw "install.ps1: pnpm install --frozen-lockfile failed."
                }
            } finally {
                Pop-Location
            }
        }
    }
}

$needPack = -not $SkipPack
if ($needPack -and (Test-PackageComplete -Dir $PackageDir) -and -not $SkipBuild) {
    Write-Step "Existing package at $PackageDir will be rebuilt"
} elseif ($needPack -and (Test-PackageComplete -Dir $PackageDir) -and $SkipBuild) {
    Write-Step "Reusing existing package at $PackageDir"
    $needPack = $false
}

if ($needPack) {
    Write-Step "Packing the Windows directory package from this checkout"
    $packArgs = @("--import", "tsx/esm", "scripts/pack-windows-cli.ts")
    if ($SkipBuild) {
        $packArgs += "--skip-build"
    }
    if ($SkipZip) {
        $packArgs += "--skip-zip"
    }
    if ($DryRun) {
        $packArgs += "--dry-run"
        Write-Host "==> [dry-run] node $($packArgs -join ' ')"
    } else {
        Push-Location $repoRoot
        try {
            # Call tsx through Node. A pnpm exec subprocess can prune the
            # checkout to production dependencies when CI=true.
            & node @packArgs
            if ($LASTEXITCODE -ne 0) {
                throw "install.ps1: pack-windows-cli failed."
            }
        } finally {
            Pop-Location
        }
    }
}

if (-not $DryRun -and -not (Test-PackageComplete -Dir $PackageDir)) {
    throw "install.ps1: packed tree at $PackageDir is incomplete. Re-run without -SkipPack."
}

$lockPath = Join-Path $env:LOCALAPPDATA "Programs\dsh-install.lock"
$installParent = Split-Path -Parent $InstallDir
$stagingDir = Join-Path $installParent (".staging-dsh." + $PID)

Write-Step "Installing to $InstallDir"
if ($DryRun) {
    Write-Host "==> [dry-run] copy $PackageDir -> $InstallDir"
} else {
    Invoke-WithInstallLock -LockPath $lockPath -Script {
        New-Item -ItemType Directory -Force -Path $installParent | Out-Null
        Copy-PackageTree -Source $PackageDir -Destination $stagingDir
        if (Test-Path -LiteralPath $InstallDir) {
            Remove-Item -LiteralPath $InstallDir -Recurse -Force
        }
        Move-Item -LiteralPath $stagingDir -Destination $InstallDir
    }
}

if (-not $SkipVerify -and -not $DryRun) {
    $launcher = Join-Path $InstallDir "dsh.cmd"
    Write-Step "Verifying $launcher --version"
    & $launcher --version
    if ($LASTEXITCODE -ne 0) {
        throw "install.ps1: installed dsh --version failed."
    }
}

if (-not $SkipPath) {
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $newUserPath = Add-PathEntry -PathValue $userPath -Entry $InstallDir
    if ($DryRun) {
        Write-Host "==> [dry-run] add $InstallDir to the user PATH"
    } elseif ($newUserPath -cne $userPath) {
        [Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
        Write-Step "PATH updated for future PowerShell sessions."
    } else {
        Write-Step "$InstallDir is already on the user PATH."
    }

    if (-not (Path-Contains -PathValue $env:Path -Entry $InstallDir)) {
        if ([string]::IsNullOrWhiteSpace($env:Path)) {
            $env:Path = $InstallDir
        } else {
            $env:Path = "$env:Path;$InstallDir"
        }
    }
}

Write-Step "Current session: dsh"
Write-Step "New windows: open a new PowerShell window and run: dsh"
Write-Host "dsh installed from this checkout into $InstallDir"
if (-not $NonInteractive -and -not [Console]::IsInputRedirected -and -not [Console]::IsOutputRedirected) {
    $choice = Read-Host "Start dsh now? [y/N]"
    if ($choice -match "^(?i:y(?:es)?)$" -and -not $DryRun) {
        Write-Step "Launching dsh"
        & (Join-Path $InstallDir "dsh.cmd")
    }
}
