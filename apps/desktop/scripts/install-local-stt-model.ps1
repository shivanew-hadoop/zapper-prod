$ErrorActionPreference = 'Stop'
# Build-time provision ONLY. App runtime never downloads models or PCM.
$name = 'sherpa-onnx-streaming-zipformer-en-2023-06-21'
$base = Join-Path (Split-Path $PSScriptRoot -Parent) 'models'
$target = Join-Path $base $name
$required = @(
  'encoder-epoch-99-avg-1.int8.onnx',
  'decoder-epoch-99-avg-1.onnx',
  'joiner-epoch-99-avg-1.int8.onnx',
  'tokens.txt'
)
function Test-Model {
  foreach ($file in $required) {
    $item = Join-Path $target $file
    if (-not (Test-Path $item -PathType Leaf)) { return $false }
    if ((Get-Item $item).Length -lt 1024) { return $false }
  }
  return $true
}
if (Test-Model) { Write-Host 'Local Zipformer model is provisioned.'; exit 0 }
New-Item $base -ItemType Directory -Force | Out-Null
$temp = Join-Path ([IO.Path]::GetTempPath()) ("zapper-zipformer-" + [Guid]::NewGuid())
New-Item $temp -ItemType Directory | Out-Null
$archive = Join-Path $temp 'model.tar.bz2'
$url = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/$name.tar.bz2"
try {
  Write-Host "Downloading model at BUILD time: $url"
  Invoke-WebRequest -Uri $url -OutFile $archive -MaximumRedirection 10
  if ((Get-Item $archive).Length -lt 10000000) { throw 'Downloaded model archive was unexpectedly small.' }
  & tar -xjf $archive -C $base
  if ($LASTEXITCODE -ne 0) { throw 'Model extraction failed.' }
  if (-not (Test-Model)) { throw "Required .onnx/tokens files missing from $target" }
  Write-Host "Zipformer model installed at $target"
} finally {
  Remove-Item $temp -Force -Recurse -ErrorAction SilentlyContinue
}
