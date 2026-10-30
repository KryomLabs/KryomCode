# Generates platform application icons from the official logo
# (Level 3C, Phase 10). The source image is never modified,
# recolored, or distorted: outputs are high-quality proportional
# resizes assembled into .ico (Windows), .icns (macOS), and .png
# (Linux) containers. Re-run to regenerate; outputs are committed.
# Requires: Windows PowerShell with System.Drawing (ships with .NET).
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$brand = Join-Path $root 'assets/branding'
$src = Join-Path $brand 'kryomcode-logo.png'

if (-not (Test-Path $src)) {
  throw "Logo source not found: $src"
}

Add-Type -AssemblyName System.Drawing

function Resize-PngBytes([string]$source, [int]$size) {
  $image = [System.Drawing.Image]::FromFile($source)
  try {
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.DrawImage($image, 0, 0, $size, $size)
      } finally {
        $graphics.Dispose()
      }
      $stream = New-Object System.IO.MemoryStream
      try {
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        # Comma-wrapped: without it PowerShell unrolls the byte array
        # into separate outputs and downstream .Length/Write calls see
        # single bytes instead of the buffer.
        return ,$stream.ToArray()
      } finally {
        $stream.Dispose()
      }
    } finally {
      $bitmap.Dispose()
    }
  } finally {
    $image.Dispose()
  }
}

function Write-Ico([string]$outPath, [int[]]$sizes) {
  # Vista+ ICO with PNG-compressed entries (valid for every size).
  $entries = @()
  foreach ($size in $sizes) {
    $entries += @{ Size = $size; Data = (Resize-PngBytes $src $size) }
  }

  $stream = New-Object System.IO.MemoryStream
  try {
    $writer = New-Object System.IO.BinaryWriter($stream)
    $writer.Write([uint16]0)          # reserved
    $writer.Write([uint16]1)          # type: icon
    $writer.Write([uint16]$entries.Count)

    $offset = 6 + (16 * $entries.Count)
    foreach ($entry in $entries) {
      $size = [int]$entry.Size
      $data = [byte[]]$entry.Data
      $byte = if ($size -ge 256) { 0 } else { $size }
      $writer.Write([byte]$byte)       # width
      $writer.Write([byte]$byte)       # height
      $writer.Write([byte]0)           # palette
      $writer.Write([byte]0)           # reserved
      $writer.Write([uint16]1)         # planes
      $writer.Write([uint16]32)        # bit count
      $writer.Write([uint32]$data.Length)
      $writer.Write([uint32]$offset)
      $offset += $data.Length
    }

    foreach ($entry in $entries) {
      $writer.Write([byte[]]$entry.Data)
    }

    $writer.Flush()
    [System.IO.File]::WriteAllBytes($outPath, $stream.ToArray())
  } finally {
    $stream.Dispose()
  }
}

function Write-Be32([System.IO.BinaryWriter]$writer, [uint32]$value) {
  $bytes = [System.BitConverter]::GetBytes($value)
  [Array]::Reverse($bytes)
  $writer.Write($bytes)
}

function Write-Icns([string]$outPath) {
  # Minimal modern .icns: PNG payloads in the icon slots macOS reads
  # (128/256/512/1024). Structurally valid for electron-builder; for a
  # Mac App Store release, regenerate with Apple's iconutil instead.
  $slots = @(
    @{ Type = 'ic07'; Size = 128 },
    @{ Type = 'ic08'; Size = 256 },
    @{ Type = 'ic09'; Size = 512 },
    @{ Type = 'ic10'; Size = 1024 }
  )

  $stream = New-Object System.IO.MemoryStream
  try {
    $writer = New-Object System.IO.BinaryWriter($stream)
    $writer.Write([System.Text.Encoding]::ASCII.GetBytes('icns'))
    Write-Be32 $writer 0  # placeholder for total length

    foreach ($slot in $slots) {
      $data = [byte[]](Resize-PngBytes $src $slot.Size)
      $writer.Write([System.Text.Encoding]::ASCII.GetBytes($slot.Type))
      Write-Be32 $writer ([uint32]($data.Length + 8))
      $writer.Write($data)
    }

    $writer.Flush()
    $bytes = $stream.ToArray()
    $total = [System.BitConverter]::GetBytes([uint32]$bytes.Length)
    [Array]::Reverse($total)
    [Array]::Copy($total, 0, $bytes, 4, 4)
    [System.IO.File]::WriteAllBytes($outPath, $bytes)
  } finally {
    $stream.Dispose()
  }
}

# Windows .ico (multi-size) and Linux .png (512).
Write-Ico (Join-Path $brand 'kryomcode-icon.ico') @(16, 24, 32, 48, 64, 128, 256)
$linux = Resize-PngBytes $src 512
[System.IO.File]::WriteAllBytes((Join-Path $brand 'kryomcode-logo-512.png'), $linux)

# macOS .icns (PNG slots; see note above).
Write-Icns (Join-Path $brand 'kryomcode-icon.icns')

Write-Host 'Icons generated in assets/branding/:'
Get-ChildItem $brand | Select-Object Name, Length | Format-Table -AutoSize
