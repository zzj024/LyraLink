param(
  [string]$PythonVersion = "3.13.5",
  [string]$WhisperModel = "small",
  [string]$Proxy = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$offlineRoot = Join-Path $projectRoot "resources\offline"
$runtime = Join-Path $offlineRoot "ai-runtime"
$models = Join-Path $offlineRoot "ai-models"
$bin = Join-Path $offlineRoot "bin"
$python = Join-Path $runtime "python.exe"

New-Item -ItemType Directory -Force -Path $offlineRoot, $models, $bin | Out-Null

if ($Proxy) {
  $env:HTTP_PROXY = $Proxy
  $env:HTTPS_PROXY = $Proxy
}

try {
  if (-not (Test-Path $python)) {
    $archive = Join-Path $offlineRoot "python-embed.zip"
    $downloadArgs = @{
      Uri = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
      OutFile = $archive
    }
    if ($Proxy) { $downloadArgs.Proxy = $Proxy }
    Invoke-WebRequest @downloadArgs
    Expand-Archive -LiteralPath $archive -DestinationPath $runtime -Force
    Remove-Item -LiteralPath $archive -Force

    $majorMinor = ($PythonVersion.Split(".")[0..1] -join "")
    $pth = Join-Path $runtime "python$majorMinor._pth"
    $pthContent = Get-Content -LiteralPath $pth -Raw
    $pthContent = $pthContent.Replace("#import site", "Lib\site-packages`r`nimport site")
    Set-Content -LiteralPath $pth -Value $pthContent -Encoding ascii

    $getPip = Join-Path $offlineRoot "get-pip.py"
    $pipDownloadArgs = @{
      Uri = "https://bootstrap.pypa.io/get-pip.py"
      OutFile = $getPip
    }
    if ($Proxy) { $pipDownloadArgs.Proxy = $Proxy }
    Invoke-WebRequest @pipDownloadArgs
    & $python $getPip
    Remove-Item -LiteralPath $getPip -Force
  }

  & $python -m pip install --disable-pip-version-check --upgrade faster-whisper
  $modelTarget = Join-Path $models $WhisperModel
  if (-not (Test-Path (Join-Path $modelTarget "model.bin"))) {
    & $python -c "from huggingface_hub import snapshot_download; snapshot_download('Systran/faster-whisper-$WhisperModel', local_dir=r'$modelTarget')"
  }

  $ffmpegSource = Join-Path $projectRoot "node_modules\ffmpeg-static\ffmpeg.exe"
  if (-not (Test-Path $ffmpegSource) -or (Get-Item $ffmpegSource).Length -eq 0) {
    $ffmpegSource = (Get-Command ffmpeg -ErrorAction Stop).Source
  }
  Copy-Item -LiteralPath $ffmpegSource -Destination (Join-Path $bin "ffmpeg.exe") -Force
} finally {
  if ($Proxy) {
    Remove-Item Env:HTTP_PROXY -ErrorAction SilentlyContinue
    Remove-Item Env:HTTPS_PROXY -ErrorAction SilentlyContinue
  }
}

Write-Output "Portable offline runtime prepared at $offlineRoot"
