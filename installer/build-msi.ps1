[CmdletBinding()]
param(
    [switch]$SkipAppBuild
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path $PSScriptRoot -Parent
$buildRoot = Join-Path $PSScriptRoot "build"
$stageRoot = Join-Path $buildRoot "stage"
$outputRoot = Join-Path $PSScriptRoot "output"
$serviceProject = Join-Path $PSScriptRoot "service-host\NeuralChatService.csproj"
$serviceOutput = Join-Path $buildRoot "service-host"
$trayProject = Join-Path $PSScriptRoot "tray-host\NeuralNetUI.Tray.csproj"
$trayOutput = Join-Path $buildRoot "tray-host"
$wix = Join-Path $PSScriptRoot ".tools\wix.exe"

Push-Location $repoRoot
try {
    if (-not $SkipAppBuild) {
        npm run build
        if ($LASTEXITCODE -ne 0) { throw "The Next.js build failed." }
    }

    $dotnet = (Get-Command dotnet -ErrorAction SilentlyContinue).Source
    if (-not $dotnet -or -not (& $dotnet --list-sdks)) {
        $dotnet = Join-Path $env:TEMP "neural-chat-dotnet-sdk-complete\dotnet.exe"
    }
    if (-not (Test-Path -LiteralPath $dotnet)) {
        throw "The .NET 8 SDK is required to build the self-contained Windows service."
    }

    & $dotnet publish $serviceProject -c Release -o $serviceOutput
    if ($LASTEXITCODE -ne 0) { throw "The service host build failed." }
    & $dotnet publish $trayProject -c Release -o $trayOutput
    if ($LASTEXITCODE -ne 0) { throw "The tray host build failed." }

    if (-not (Test-Path -LiteralPath $wix)) {
        New-Item -ItemType Directory -Path (Split-Path $wix) -Force | Out-Null
        & $dotnet tool install wix --tool-path (Split-Path $wix) --version "5.*"
        if ($LASTEXITCODE -ne 0) { throw "WiX Toolset installation failed." }
        & $wix extension add WixToolset.UI.wixext/5.0.2
    }

    $resolvedBuildRoot = [IO.Path]::GetFullPath($buildRoot)
    $resolvedStageRoot = [IO.Path]::GetFullPath($stageRoot)
    if (-not $resolvedStageRoot.StartsWith($resolvedBuildRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clear a staging path outside installer/build."
    }
    if (Test-Path -LiteralPath $resolvedStageRoot) { Remove-Item -LiteralPath $resolvedStageRoot -Recurse -Force }
    New-Item -ItemType Directory -Path (Join-Path $stageRoot "app\.next") -Force | Out-Null
    New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

    Copy-Item -Path ".next\standalone\*" -Destination (Join-Path $stageRoot "app") -Recurse -Force
    Copy-Item -Path ".next\static" -Destination (Join-Path $stageRoot "app\.next\static") -Recurse -Force
    if (Test-Path -LiteralPath "public") { Copy-Item -Path "public" -Destination (Join-Path $stageRoot "app\public") -Recurse -Force }
    New-Item -ItemType Directory -Path (Join-Path $stageRoot "app\scripts") -Force | Out-Null
    Copy-Item -LiteralPath "scripts\ddgs-search.py" -Destination (Join-Path $stageRoot "app\scripts\ddgs-search.py") -Force
    Copy-Item -LiteralPath "requirements.txt" -Destination (Join-Path $stageRoot "app\requirements.txt") -Force

    $python = (Get-Command python -ErrorAction SilentlyContinue).Source
    if (-not $python) { throw "Python 3 is required to bundle the DDGS internet-search runtime." }
    $pythonVersion = & $python -c "import platform; print(platform.python_version())"
    $pythonArch = & $python -c "import platform; print(platform.architecture()[0])"
    if ($pythonArch -ne "64bit") { throw "A 64-bit Python build is required for the x64 installer." }
    $embeddedRoot = Join-Path $stageRoot "app\.python"
    $embeddedZip = Join-Path $buildRoot "python-$pythonVersion-embed-amd64.zip"
    if (-not (Test-Path -LiteralPath $embeddedZip)) {
        Invoke-WebRequest -UseBasicParsing -Uri "https://www.python.org/ftp/python/$pythonVersion/python-$pythonVersion-embed-amd64.zip" -OutFile $embeddedZip
    }
    Expand-Archive -LiteralPath $embeddedZip -DestinationPath $embeddedRoot -Force
    $pthFile = Get-ChildItem -LiteralPath $embeddedRoot -Filter "python*._pth" | Select-Object -First 1
    if (-not $pthFile) { throw "The embedded Python path configuration was not found." }
    $pth = (Get-Content -LiteralPath $pthFile.FullName -Raw).Replace("#import site", "import site")
    if (-not $pth.Contains("Lib\site-packages")) { $pth += "`r`nLib\site-packages`r`n" }
    Set-Content -LiteralPath $pthFile.FullName -Value $pth -Encoding ascii
    $embeddedPackages = Join-Path $embeddedRoot "Lib\site-packages"
    New-Item -ItemType Directory -Path $embeddedPackages -Force | Out-Null
    & $python -m pip install --disable-pip-version-check --no-compile --only-binary=:all: --target $embeddedPackages -r requirements.txt
    if ($LASTEXITCODE -ne 0) { throw "The DDGS Python dependencies could not be bundled." }
    Copy-Item -LiteralPath (Get-Command node).Source -Destination (Join-Path $stageRoot "node.exe") -Force
    Copy-Item -LiteralPath (Join-Path $serviceOutput "NeuralChatService.exe") -Destination $stageRoot -Force
    Copy-Item -LiteralPath (Join-Path $trayOutput "NeuralNetUI.Tray.exe") -Destination $stageRoot -Force

    & $wix build (Join-Path $PSScriptRoot "Product.wxs") `
        -arch x64 `
        -ct 1 `
        -ext WixToolset.UI.wixext `
        -d "StagePath=$stageRoot" `
        -intermediatefolder (Join-Path $buildRoot "wixobj") `
        -o (Join-Path $outputRoot "NeuralNetUI-1.3.3-x64.msi")
    if ($LASTEXITCODE -ne 0) { throw "The MSI build failed." }
} finally {
    Pop-Location
}
