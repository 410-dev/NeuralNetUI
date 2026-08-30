$ErrorActionPreference = "Stop"

$projectRoot = $PSScriptRoot
$androidSdk = $env:ANDROID_HOME
if (-not $androidSdk) { $androidSdk = $env:ANDROID_SDK_ROOT }
if (-not $androidSdk) { $androidSdk = Join-Path $env:LOCALAPPDATA "Android\Sdk" }

$buildTools = Join-Path $androidSdk "build-tools\36.0.0"
$androidJar = Join-Path $androidSdk "platforms\android-36\android.jar"
$javaHome = $env:JAVA_HOME
if (-not $javaHome) { $javaHome = "C:\Program Files\Android\Android Studio\jbr" }
$javaBin = Join-Path $javaHome "bin"

$required = @(
    (Join-Path $buildTools "aapt2.exe"),
    (Join-Path $buildTools "aapt.exe"),
    (Join-Path $buildTools "d8.bat"),
    (Join-Path $buildTools "zipalign.exe"),
    (Join-Path $buildTools "apksigner.bat"),
    (Join-Path $javaBin "javac.exe"),
    (Join-Path $javaBin "keytool.exe"),
    $androidJar
)
foreach ($path in $required) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Required local tool is missing: $path" }
}

Push-Location $projectRoot
try {
    $manual = Join-Path $projectRoot "app\build\manual"
    $classesDir = Join-Path $manual "classes"
    $dexDir = Join-Path $manual "dex"
    $outputDir = Join-Path $projectRoot "app\build\outputs\apk\debug"
    New-Item -ItemType Directory -Force -Path $classesDir, $dexDir, $outputDir | Out-Null

    $sources = Get-ChildItem -LiteralPath "app\src\main\java" -Recurse -Filter "*.java" | Select-Object -ExpandProperty FullName
    & (Join-Path $javaBin "javac.exe") -encoding UTF-8 -source 17 -target 17 -cp $androidJar -d $classesDir $sources
    if ($LASTEXITCODE) { throw "javac failed" }

    $resources = Join-Path $manual "resources.zip"
    & (Join-Path $buildTools "aapt2.exe") compile --dir "app\src\main\res" -o $resources
    if ($LASTEXITCODE) { throw "aapt2 compile failed" }

    $unsigned = Join-Path $manual "unsigned.apk"
    & (Join-Path $buildTools "aapt2.exe") link -o $unsigned -I $androidJar --manifest "app\src\main\AndroidManifest.xml" --min-sdk-version 26 --target-sdk-version 36 --version-code 1 --version-name 1.0.0 --auto-add-overlay $resources
    if ($LASTEXITCODE) { throw "aapt2 link failed" }

    $classes = Get-ChildItem -LiteralPath $classesDir -Recurse -Filter "*.class" | Select-Object -ExpandProperty FullName
    & (Join-Path $buildTools "d8.bat") --lib $androidJar --min-api 26 --output $dexDir $classes
    if ($LASTEXITCODE) { throw "d8 failed" }

    Push-Location $dexDir
    try { & (Join-Path $buildTools "aapt.exe") add $unsigned "classes.dex" }
    finally { Pop-Location }
    if ($LASTEXITCODE) { throw "Adding classes.dex failed" }

    $aligned = Join-Path $manual "aligned.apk"
    & (Join-Path $buildTools "zipalign.exe") -f 4 $unsigned $aligned
    if ($LASTEXITCODE) { throw "zipalign failed" }

    $debugKey = Join-Path $manual "debug.keystore"
    if (-not (Test-Path -LiteralPath $debugKey)) {
        & (Join-Path $javaBin "keytool.exe") -genkeypair -keystore $debugKey -storepass android -alias androiddebugkey -keypass android -dname "CN=Android Debug,O=Android,C=US" -keyalg RSA -keysize 2048 -validity 10000
        if ($LASTEXITCODE) { throw "Creating the debug signing key failed" }
    }

    $apk = Join-Path $outputDir "app-debug.apk"
    & (Join-Path $buildTools "apksigner.bat") sign --ks $debugKey --ks-pass pass:android --key-pass pass:android --out $apk $aligned
    if ($LASTEXITCODE) { throw "APK signing failed" }
    & (Join-Path $buildTools "apksigner.bat") verify --verbose $apk
    if ($LASTEXITCODE) { throw "APK verification failed" }
    Get-Item -LiteralPath $apk
}
finally {
    Pop-Location
}
