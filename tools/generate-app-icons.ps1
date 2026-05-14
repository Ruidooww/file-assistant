[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root "assets\icons"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-Color {
  param([Parameter(Mandatory = $true)][string]$Hex, [int]$Alpha = 255)
  $value = $Hex.TrimStart("#")
  return [System.Drawing.Color]::FromArgb(
    $Alpha,
    [Convert]::ToInt32($value.Substring(0, 2), 16),
    [Convert]::ToInt32($value.Substring(2, 2), 16),
    [Convert]::ToInt32($value.Substring(4, 2), 16))
}

function New-RoundedRectanglePath {
  param(
    [float]$X,
    [float]$Y,
    [float]$Width,
    [float]$Height,
    [float]$Radius
  )
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $diameter = $Radius * 2
  $path.AddArc($X, $Y, $diameter, $diameter, 180, 90)
  $path.AddArc($X + $Width - $diameter, $Y, $diameter, $diameter, 270, 90)
  $path.AddArc($X + $Width - $diameter, $Y + $Height - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc($X, $Y + $Height - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()
  return $path
}

function Set-HighQuality {
  param([Parameter(Mandatory = $true)][System.Drawing.Graphics]$Graphics)
  $Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $Graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
}

function New-ClientBitmap {
  param([int]$Size)

  $bmp = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  Set-HighQuality $g
  $g.Clear([System.Drawing.Color]::Transparent)

  $pad = [Math]::Max(1, $Size * 0.055)
  $bgRect = [System.Drawing.RectangleF]::new($pad, $pad, $Size - ($pad * 2), $Size - ($pad * 2))
  $bgPath = New-RoundedRectanglePath $bgRect.X $bgRect.Y $bgRect.Width $bgRect.Height ($Size * 0.22)
  $bgBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    $bgRect,
    (New-Color "#0F766E"),
    (New-Color "#0EA5E9"),
    [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)
  $g.FillPath($bgBrush, $bgPath)

  $highlightBrush = [System.Drawing.SolidBrush]::new((New-Color "#FFFFFF" 32))
  $highlightPath = New-RoundedRectanglePath ($Size * 0.17) ($Size * 0.14) ($Size * 0.52) ($Size * 0.22) ($Size * 0.11)
  $g.FillPath($highlightBrush, $highlightPath)

  $docX = $Size * 0.29
  $docY = $Size * 0.20
  $docW = $Size * 0.45
  $docH = $Size * 0.58
  $fold = $Size * 0.14
  $docPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $docPath.AddLine($docX, $docY, $docX + $docW - $fold, $docY)
  $docPath.AddLine($docX + $docW - $fold, $docY, $docX + $docW, $docY + $fold)
  $docPath.AddLine($docX + $docW, $docY + $fold, $docX + $docW, $docY + $docH)
  $docPath.AddLine($docX + $docW, $docY + $docH, $docX, $docY + $docH)
  $docPath.CloseFigure()

  $docBrush = [System.Drawing.SolidBrush]::new((New-Color "#F8FEFF"))
  $docPen = [System.Drawing.Pen]::new((New-Color "#E0F2FE" 220), [Math]::Max(1, $Size * 0.018))
  $g.FillPath($docBrush, $docPath)
  $g.DrawPath($docPen, $docPath)

  $foldPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $foldPath.AddLine($docX + $docW - $fold, $docY, $docX + $docW - $fold, $docY + $fold)
  $foldPath.AddLine($docX + $docW - $fold, $docY + $fold, $docX + $docW, $docY + $fold)
  $foldPath.CloseFigure()
  $foldBrush = [System.Drawing.SolidBrush]::new((New-Color "#BFEFFF"))
  $g.FillPath($foldBrush, $foldPath)

  $linePen = [System.Drawing.Pen]::new((New-Color "#0F766E" 95), [Math]::Max(1, $Size * 0.024))
  $g.DrawLine($linePen, $docX + ($Size * 0.09), $docY + ($Size * 0.26), $docX + $docW - ($Size * 0.10), $docY + ($Size * 0.26))
  $g.DrawLine($linePen, $docX + ($Size * 0.09), $docY + ($Size * 0.37), $docX + $docW - ($Size * 0.15), $docY + ($Size * 0.37))

  $arrowPen = [System.Drawing.Pen]::new((New-Color "#10B981"), [Math]::Max(2, $Size * 0.070))
  $arrowPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $arrowPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Triangle
  $g.DrawLine($arrowPen, $Size * 0.25, $Size * 0.72, $Size * 0.62, $Size * 0.52)

  $sparkBrush = [System.Drawing.SolidBrush]::new((New-Color "#A7F3D0"))
  $g.FillEllipse($sparkBrush, $Size * 0.67, $Size * 0.22, $Size * 0.08, $Size * 0.08)
  $g.FillEllipse($sparkBrush, $Size * 0.20, $Size * 0.25, $Size * 0.055, $Size * 0.055)

  $g.Dispose()
  return $bmp
}

function New-ServerBitmap {
  param([int]$Size)

  $bmp = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  Set-HighQuality $g
  $g.Clear([System.Drawing.Color]::Transparent)

  $pad = [Math]::Max(1, $Size * 0.055)
  $bgRect = [System.Drawing.RectangleF]::new($pad, $pad, $Size - ($pad * 2), $Size - ($pad * 2))
  $bgPath = New-RoundedRectanglePath $bgRect.X $bgRect.Y $bgRect.Width $bgRect.Height ($Size * 0.22)
  $bgBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    $bgRect,
    (New-Color "#1D4ED8"),
    (New-Color "#0F766E"),
    [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal)
  $g.FillPath($bgBrush, $bgPath)

  $glowBrush = [System.Drawing.SolidBrush]::new((New-Color "#FFFFFF" 28))
  $glowPath = New-RoundedRectanglePath ($Size * 0.18) ($Size * 0.12) ($Size * 0.56) ($Size * 0.24) ($Size * 0.12)
  $g.FillPath($glowBrush, $glowPath)

  $serverX = $Size * 0.23
  $serverW = $Size * 0.54
  $serverH = $Size * 0.13
  $gap = $Size * 0.075
  $firstY = $Size * 0.28

  $serverBrush = [System.Drawing.SolidBrush]::new((New-Color "#F8FEFF"))
  $serverPen = [System.Drawing.Pen]::new((New-Color "#DBEAFE" 230), [Math]::Max(1, $Size * 0.018))
  $slotPen = [System.Drawing.Pen]::new((New-Color "#1D4ED8" 130), [Math]::Max(1, $Size * 0.018))
  $dotBrush = [System.Drawing.SolidBrush]::new((New-Color "#34D399"))

  for ($i = 0; $i -lt 3; $i++) {
    $y = $firstY + (($serverH + $gap) * $i)
    $rackPath = New-RoundedRectanglePath $serverX $y $serverW $serverH ($Size * 0.035)
    $g.FillPath($serverBrush, $rackPath)
    $g.DrawPath($serverPen, $rackPath)
    $g.DrawLine($slotPen, $serverX + ($Size * 0.12), $y + ($serverH * 0.50), $serverX + ($serverW * 0.65), $y + ($serverH * 0.50))
    $g.FillEllipse($dotBrush, $serverX + $serverW - ($Size * 0.13), $y + ($serverH * 0.32), $Size * 0.045, $Size * 0.045)
  }

  $netPen = [System.Drawing.Pen]::new((New-Color "#A7F3D0"), [Math]::Max(2, $Size * 0.045))
  $netPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $netPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawLine($netPen, $Size * 0.31, $Size * 0.78, $Size * 0.50, $Size * 0.88)
  $g.DrawLine($netPen, $Size * 0.69, $Size * 0.78, $Size * 0.50, $Size * 0.88)

  $nodeBrush = [System.Drawing.SolidBrush]::new((New-Color "#ECFDF5"))
  $nodePen = [System.Drawing.Pen]::new((New-Color "#10B981"), [Math]::Max(1, $Size * 0.020))
  foreach ($pt in @(@(0.31, 0.78), @(0.50, 0.88), @(0.69, 0.78))) {
    $d = $Size * 0.075
    $x = ($Size * $pt[0]) - ($d / 2)
    $y = ($Size * $pt[1]) - ($d / 2)
    $g.FillEllipse($nodeBrush, $x, $y, $d, $d)
    $g.DrawEllipse($nodePen, $x, $y, $d, $d)
  }

  $g.Dispose()
  return $bmp
}

function Save-Icon {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Factory,
    [Parameter(Mandatory = $true)][string]$IcoPath,
    [Parameter(Mandatory = $true)][string]$PreviewPath
  )

  $sizes = @(16, 24, 32, 48, 64, 128, 256)
  $entries = @()

  foreach ($size in $sizes) {
    $bmp = & $Factory $size
    $ms = [System.IO.MemoryStream]::new()
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $entries += [pscustomobject]@{
      Size = $size
      Bytes = $ms.ToArray()
      Bitmap = $bmp
      Stream = $ms
    }
  }

  $preview = & $Factory 256
  $preview.Save($PreviewPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $preview.Dispose()

  $fs = [System.IO.File]::Open($IcoPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
  $writer = [System.IO.BinaryWriter]::new($fs)
  try {
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]$entries.Count)

    $offset = 6 + (16 * $entries.Count)
    foreach ($entry in $entries) {
      $encodedSize = if ($entry.Size -eq 256) { 0 } else { $entry.Size }
      $writer.Write([byte]$encodedSize)
      $writer.Write([byte]$encodedSize)
      $writer.Write([byte]0)
      $writer.Write([byte]0)
      $writer.Write([UInt16]1)
      $writer.Write([UInt16]32)
      $writer.Write([UInt32]$entry.Bytes.Length)
      $writer.Write([UInt32]$offset)
      $offset += $entry.Bytes.Length
    }

    foreach ($entry in $entries) {
      $writer.Write($entry.Bytes)
    }
  }
  finally {
    $writer.Dispose()
    $fs.Dispose()
    foreach ($entry in $entries) {
      $entry.Bitmap.Dispose()
      $entry.Stream.Dispose()
    }
  }
}

Save-Icon -Factory ${function:New-ClientBitmap} `
  -IcoPath (Join-Path $outDir "file-assistant-client.ico") `
  -PreviewPath (Join-Path $outDir "file-assistant-client-256.png")

Save-Icon -Factory ${function:New-ServerBitmap} `
  -IcoPath (Join-Path $outDir "file-assistant-server.ico") `
  -PreviewPath (Join-Path $outDir "file-assistant-server-256.png")

Write-Host "Generated icons in $outDir"
