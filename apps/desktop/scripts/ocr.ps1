param(
  [Parameter(Mandatory = $true)][string]$Path,
  [string]$Language = 'zh-Hans-CN'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
$asTaskAction = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction'
  })[0]

function Await-Operation($operation, [Type]$type) {
  $task = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($operation))
  $task.Wait()
  return $task.Result
}

function Await-Action($action) {
  $task = $asTaskAction.Invoke($null, @($action))
  $task.Wait()
}

[Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.FileAccessMode, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Pdf.PdfDocument, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Pdf.PdfPageRenderOptions, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapTransform, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapPixelFormat, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapAlphaMode, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.ExifOrientationMode, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.ColorManagementMode, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null

$resolved = (Resolve-Path $Path).Path
$file = Await-Operation ([Windows.Storage.StorageFile]::GetFileFromPathAsync($resolved)) ([Windows.Storage.StorageFile])

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new($Language))
if ($null -eq $engine) {
  throw "OCR language not available: $Language"
}
$max = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
$targetMax = [Math]::Min([Math]::Floor($max * 0.9), 2048)

function Get-OcrText($bitmap) {
  $result = Await-Operation ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  return $result.Text
}

$extension = [System.IO.Path]::GetExtension($resolved).ToLowerInvariant()
$lines = New-Object System.Collections.Generic.List[string]

if ('.pdf' -eq $extension) {
  $document = Await-Operation ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
  for ($index = 0; $index -lt $document.PageCount; $index++) {
    $page = $document.GetPage([uint32]$index)
    try {
      $scale = [Math]::Min(2.0, $targetMax / [Math]::Max($page.Size.Width, $page.Size.Height))
      $options = [Windows.Data.Pdf.PdfPageRenderOptions]::new()
      $options.DestinationWidth = [uint32][Math]::Max(1, [Math]::Round($page.Size.Width * $scale))
      $options.DestinationHeight = [uint32][Math]::Max(1, [Math]::Round($page.Size.Height * $scale))

      $stream = [Windows.Storage.Streams.InMemoryRandomAccessStream]::new()
      try {
        Await-Action ($page.RenderToStreamAsync($stream, $options))
        $stream.Seek(0)
        $decoder = Await-Operation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bitmap = Await-Operation ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        try {
          $lines.Add((Get-OcrText $bitmap))
        } finally {
          $bitmap.Dispose()
        }
      } finally {
        $stream.Dispose()
      }
    } finally {
      $page.Dispose()
    }
  }
} else {
  $imageStream = Await-Operation ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  try {
    $decoder = Await-Operation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($imageStream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $pixelWidth = $decoder.PixelWidth
    $pixelHeight = $decoder.PixelHeight
    $maxDimension = [Math]::Max($pixelWidth, $pixelHeight)
    if ($maxDimension -gt $targetMax) {
      $transform = [Windows.Graphics.Imaging.BitmapTransform]::new()
      $transform.ScaledWidth = [uint32][Math]::Max(1, [Math]::Round($pixelWidth * $targetMax / $maxDimension))
      $transform.ScaledHeight = [uint32][Math]::Max(1, [Math]::Round($pixelHeight * $targetMax / $maxDimension))
      $bitmap = Await-Operation ($decoder.GetSoftwareBitmapAsync(
        [Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8,
        [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied,
        $transform,
        [Windows.Graphics.Imaging.ExifOrientationMode]::IgnoreExifOrientation,
        [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage
      )) ([Windows.Graphics.Imaging.SoftwareBitmap])
    } else {
      $bitmap = Await-Operation ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    }
    try {
      $lines.Add((Get-OcrText $bitmap))
    } finally {
      $bitmap.Dispose()
    }
  } finally {
    $imageStream.Dispose()
  }
}

$lines -join "`n"