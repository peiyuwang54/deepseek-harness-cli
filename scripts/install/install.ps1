# deepseek-harness-cli installer for Windows. Downloads the matching directory
# runtime from a deepseek-harness-cli-v* GitHub Release, verifies its sha256
# sidecar and package manifest, installs it under LocalAppData, and adds the
# install directory to the user PATH.
#
#   irm https://raw.githubusercontent.com/peiyuwang54/deepseek-harness-cli/master/scripts/install/install.ps1 | iex
#
# A checkout-built package remains installable for development:
#
#   pnpm run pack:windows-cli
#   powershell -ExecutionPolicy Bypass -File .\scripts\install\install.ps1 -PackageDir .\dist-windows\dsh

[CmdletBinding()]
param(
    [string]$Version = $env:DEEPSEEK_HARNESS_CLI_VERSION,
    [string]$InstallDir = $env:DEEPSEEK_HARNESS_CLI_INSTALL_DIR,
    [string]$BaseUrl = $env:DEEPSEEK_HARNESS_CLI_BASE_URL,
    [string]$PackageDir = "",
    [switch]$SkipPath,
    [switch]$SkipVerify,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Repository = "peiyuwang54/deepseek-harness-cli"
$ReleaseTagPrefix = "deepseek-harness-cli-v"
$NonInteractive = $env:DSH_NON_INTERACTIVE -match "^(?i:1|true|yes)$"

function Write-Step {
    param([string]$Message)
    Write-Host "==> $Message"
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
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while ($null -eq $lock) {
        try {
            $lock = [System.IO.File]::Open(
                $LockPath,
                [System.IO.FileMode]::OpenOrCreate,
                [System.IO.FileAccess]::ReadWrite,
                [System.IO.FileShare]::None
            )
        } catch [System.IO.IOException] {
            if ([DateTime]::UtcNow -ge $deadline) {
                throw "install.ps1: timed out waiting for another installer to release $LockPath."
            }
            Start-Sleep -Milliseconds 250
        }
    }
    try {
        & $Script
    } finally {
        $lock.Dispose()
    }
}

function Resolve-ReleaseVersion {
    param([string]$RequestedVersion)

    if (-not [string]::IsNullOrWhiteSpace($RequestedVersion)) {
        $normalized = $RequestedVersion.Trim()
        if ($normalized.StartsWith($ReleaseTagPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            $normalized = $normalized.Substring($ReleaseTagPrefix.Length)
        } elseif ($normalized.StartsWith("v", [StringComparison]::OrdinalIgnoreCase)) {
            $normalized = $normalized.Substring(1)
        }
        if ($normalized -notmatch "^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$") {
            throw "install.ps1: invalid release version '$RequestedVersion'."
        }
        return $normalized
    }

    Write-Step "Resolving the newest deepseek-harness-cli release"
    $headers = @{
        Accept = "application/vnd.github+json"
        "User-Agent" = "deepseek-harness-cli-installer"
    }
    $releases = Invoke-RestMethod -Headers $headers -Uri "https://api.github.com/repos/$Repository/releases?per_page=100"
    foreach ($release in @($releases)) {
        if ($null -ne $release.tag_name -and $release.tag_name.StartsWith($ReleaseTagPrefix, [StringComparison]::Ordinal)) {
            return $release.tag_name.Substring($ReleaseTagPrefix.Length)
        }
    }
    throw "install.ps1: could not determine the newest release; set DEEPSEEK_HARNESS_CLI_VERSION or -Version."
}

function Save-Url {
    param(
        [string]$Url,
        [string]$Destination
    )

    Write-Step "Downloading $Url"
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Destination
}

function Assert-Checksum {
    param(
        [string]$Asset,
        [string]$Sidecar
    )

    $sidecarText = (Get-Content -LiteralPath $Sidecar -Raw).Trim()
    $match = [regex]::Match($sidecarText, "^(?i:([0-9a-f]{64}))(?:\s+\*?.+)?$")
    if (-not $match.Success) {
        throw "install.ps1: malformed sha256 sidecar for $(Split-Path -Leaf $Asset)."
    }
    $expected = $match.Groups[1].Value.ToLowerInvariant()
    $actual = (Get-FileHash -LiteralPath $Asset -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
        throw "install.ps1: sha256 mismatch for $(Split-Path -Leaf $Asset); expected $expected, got $actual."
    }
}

function Test-PackageComplete {
    param([string]$Dir)

    $required = @(
        "node.exe",
        "dsh.cmd",
        "deepseek-harness-cli.cmd",
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

function Assert-PackageManifest {
    param(
        [string]$Dir,
        [string]$ExpectedArch,
        [string]$ExpectedVersion
    )

    if (-not (Test-PackageComplete -Dir $Dir)) {
        throw "install.ps1: package tree at $Dir is incomplete."
    }
    $manifestPath = Join-Path $Dir "dsh-install.json"
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    foreach ($property in @("name", "version", "platform", "arch", "node", "entry", "defaultProfile")) {
        if ($manifest.PSObject.Properties.Name -notcontains $property) {
            throw "install.ps1: $manifestPath is missing '$property'."
        }
    }
    if ($manifest.name -ne "dsh" -or $manifest.platform -ne "win32") {
        throw "install.ps1: $manifestPath is not a Windows dsh package."
    }
    if ($manifest.arch -ne $ExpectedArch) {
        throw "install.ps1: package architecture '$($manifest.arch)' does not match this host '$ExpectedArch'."
    }
    if (-not [string]::IsNullOrWhiteSpace($ExpectedVersion) -and $manifest.version -ne $ExpectedVersion) {
        throw "install.ps1: package version '$($manifest.version)' does not match requested version '$ExpectedVersion'."
    }
    if ($manifest.entry -ne "lib/bin.js" -or $manifest.defaultProfile -ne "tui") {
        throw "install.ps1: $manifestPath names an unsupported launcher layout."
    }
}

function Assert-SafeInstallDirectory {
    param([string]$Directory)

    $full = [System.IO.Path]::GetFullPath($Directory).TrimEnd("\")
    $root = [System.IO.Path]::GetPathRoot($full).TrimEnd("\")
    if ([string]::IsNullOrWhiteSpace($root) -or $full -ieq $root) {
        throw "install.ps1: refusing to install into filesystem root '$Directory'."
    }
    foreach ($protected in @($env:USERPROFILE, $env:LOCALAPPDATA, $env:APPDATA)) {
        if (-not [string]::IsNullOrWhiteSpace($protected) -and $full -ieq $protected.TrimEnd("\")) {
            throw "install.ps1: refusing to replace protected directory '$Directory'."
        }
    }
    return $full
}

function Copy-PackageTree {
    param(
        [string]$Source,
        [string]$Destination
    )

    if (Test-Path -LiteralPath $Destination) {
        Remove-Item -LiteralPath $Destination -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    # Copy-Item hits MAX_PATH on nested node_modules; robocopy accepts them.
    & robocopy $Source $Destination /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP
    if ($LASTEXITCODE -ge 8) {
        throw "install.ps1: robocopy failed with exit code $LASTEXITCODE while copying $Source to $Destination."
    }
}

if ($env:OS -ne "Windows_NT") {
    Write-Error "install.ps1 supports Windows only."
    exit 1
}
if (-not [Environment]::Is64BitOperatingSystem) {
    Write-Error "deepseek-harness-cli requires a 64-bit version of Windows."
    exit 1
}

$processorArchitecture = $env:PROCESSOR_ARCHITECTURE
if (-not [string]::IsNullOrWhiteSpace($env:PROCESSOR_ARCHITEW6432)) {
    $processorArchitecture = $env:PROCESSOR_ARCHITEW6432
}
switch ($processorArchitecture) {
    "AMD64" { $architecture = "x64" }
    "ARM64" { $architecture = "arm64" }
    default {
        Write-Error "Unsupported architecture: $processorArchitecture. Supported: AMD64 and ARM64."
        exit 1
    }
}

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    if (-not [string]::IsNullOrWhiteSpace($env:DSH_INSTALL_DIR)) {
        $InstallDir = $env:DSH_INSTALL_DIR
    } else {
        $InstallDir = Join-Path $env:LOCALAPPDATA "Programs\dsh"
    }
}
$InstallDir = Assert-SafeInstallDirectory -Directory $InstallDir
$installParent = Split-Path -Parent $InstallDir
$lockPath = Join-Path $env:LOCALAPPDATA "Programs\dsh-install.lock"
$operationId = "$PID.$([Guid]::NewGuid().ToString('N'))"
$stagingDir = Join-Path $installParent ".staging-dsh.$operationId"
$backupDir = Join-Path $installParent ".backup-dsh.$operationId"
$temporaryDir = ""
$sourcePackage = ""
$resolvedVersion = ""

try {
    if (-not [string]::IsNullOrWhiteSpace($PackageDir)) {
        $sourcePackage = (Resolve-Path -LiteralPath $PackageDir).Path
        $resolvedVersion = $Version
        Assert-PackageManifest -Dir $sourcePackage -ExpectedArch $architecture -ExpectedVersion $resolvedVersion
        Write-Step "Using local package $sourcePackage"
    } else {
        $resolvedVersion = Resolve-ReleaseVersion -RequestedVersion $Version
        if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
            $BaseUrl = "https://github.com/$Repository/releases/download"
        }
        $releaseUrl = "$($BaseUrl.TrimEnd('/'))/$ReleaseTagPrefix$resolvedVersion"
        $assetName = "deepseek-harness-cli-$architecture-windows.zip"
        $assetUrl = "$releaseUrl/$assetName"
        $sidecarUrl = "$assetUrl.sha256"
        Write-Step "Installing deepseek-harness-cli $resolvedVersion for windows-$architecture"

        if ($DryRun) {
            Write-Host "==> [dry-run] download $assetUrl"
            Write-Host "==> [dry-run] download $sidecarUrl"
            Write-Host "==> [dry-run] verify sha256 and package manifest"
            $sourcePackage = "<downloaded-package>"
        } else {
            $temporaryDir = Join-Path ([System.IO.Path]::GetTempPath()) "deepseek-harness-cli-install.$operationId"
            New-Item -ItemType Directory -Force -Path $temporaryDir | Out-Null
            $asset = Join-Path $temporaryDir $assetName
            $sidecar = "$asset.sha256"
            Save-Url -Url $assetUrl -Destination $asset
            Save-Url -Url $sidecarUrl -Destination $sidecar
            Assert-Checksum -Asset $asset -Sidecar $sidecar
            $expanded = Join-Path $temporaryDir "expanded"
            Expand-Archive -LiteralPath $asset -DestinationPath $expanded
            $sourcePackage = Join-Path $expanded "dsh"
            Assert-PackageManifest -Dir $sourcePackage -ExpectedArch $architecture -ExpectedVersion $resolvedVersion
        }
    }

    Write-Step "Installing to $InstallDir"
    if ($DryRun) {
        Write-Host "==> [dry-run] replace $InstallDir from $sourcePackage"
    } else {
        Invoke-WithInstallLock -LockPath $lockPath -Script {
            New-Item -ItemType Directory -Force -Path $installParent | Out-Null
            Copy-PackageTree -Source $sourcePackage -Destination $stagingDir
            if (Test-Path -LiteralPath $InstallDir) {
                Move-Item -LiteralPath $InstallDir -Destination $backupDir
            }
            try {
                Move-Item -LiteralPath $stagingDir -Destination $InstallDir
                if (-not $SkipVerify) {
                    $launcher = Join-Path $InstallDir "deepseek-harness-cli.cmd"
                    Write-Step "Verifying $launcher --version"
                    $installedVersion = (& $launcher --version | Out-String).Trim()
                    if ($LASTEXITCODE -ne 0) {
                        throw "install.ps1: installed deepseek-harness-cli --version failed."
                    }
                    if (-not [string]::IsNullOrWhiteSpace($resolvedVersion) -and $installedVersion -ne $resolvedVersion) {
                        throw "install.ps1: installed command reports '$installedVersion', expected '$resolvedVersion'."
                    }
                }
            } catch {
                if (Test-Path -LiteralPath $InstallDir) {
                    Remove-Item -LiteralPath $InstallDir -Recurse -Force
                }
                if (Test-Path -LiteralPath $backupDir) {
                    Move-Item -LiteralPath $backupDir -Destination $InstallDir
                }
                throw
            }
            if (Test-Path -LiteralPath $backupDir) {
                Remove-Item -LiteralPath $backupDir -Recurse -Force
            }
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

    Write-Step "Current session: deepseek-harness-cli"
    Write-Step "New windows: open PowerShell and run deepseek-harness-cli"
    Write-Host "deepseek-harness-cli installed in $InstallDir"
    if (-not $NonInteractive -and -not [Console]::IsInputRedirected -and -not [Console]::IsOutputRedirected) {
        $choice = Read-Host "Start deepseek-harness-cli now? [y/N]"
        if ($choice -match "^(?i:y(?:es)?)$" -and -not $DryRun) {
            Write-Step "Launching deepseek-harness-cli"
            & (Join-Path $InstallDir "deepseek-harness-cli.cmd")
        }
    }
} finally {
    # A backup is deliberately preserved if rollback itself fails.
    foreach ($path in @($stagingDir, $temporaryDir)) {
        if (-not [string]::IsNullOrWhiteSpace($path) -and (Test-Path -LiteralPath $path)) {
            Remove-Item -LiteralPath $path -Recurse -Force
        }
    }
}
