# Packs the game into one self-contained HTML file that runs by double-click (no server).
# Images and sounds are embedded as data: URIs; character parts and weapons are
# shrunk (the game draws them at 40% anyway) and sounds are halved to 24 kHz.
# -Artifact builds the claude.ai Artifact variant instead: a page fragment without the
# 3.8 MB UI font (it falls back to Jua from Google Fonts) and with the viewer's gutters.
param(
  [switch]$Artifact,
  [string]$Out = (Join-Path (Split-Path -Parent $PSScriptRoot) $(if ($Artifact) { 'dist\phalanx-rush-artifact.html' } else { '방진돌격대.html' })),
  [double]$PartScale = 0.6,
  [int]$AudioRate = 24000
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.IO;
public static class Wav {
  // Halve a 16-bit PCM WAV's sample rate by averaging sample pairs (per channel).
  public static byte[] Downsample(byte[] src, int targetRate) {
    int pos = 12, ch = 0, rate = 0, bits = 0, dataOff = -1, dataLen = 0;
    while (pos + 8 <= src.Length) {
      string id = System.Text.Encoding.ASCII.GetString(src, pos, 4);
      int len = BitConverter.ToInt32(src, pos + 4);
      if (id == "fmt ") { ch = BitConverter.ToInt16(src, pos + 10); rate = BitConverter.ToInt32(src, pos + 12); bits = BitConverter.ToInt16(src, pos + 22); }
      else if (id == "data") { dataOff = pos + 8; dataLen = Math.Min(len, src.Length - dataOff); break; }
      pos += 8 + len + (len & 1);
    }
    if (dataOff < 0 || bits != 16 || rate != targetRate * 2) return src;
    int frames = dataLen / (2 * ch) / 2;
    var ms = new MemoryStream();
    var w = new BinaryWriter(ms);
    w.Write(System.Text.Encoding.ASCII.GetBytes("RIFF")); w.Write(36 + frames * ch * 2);
    w.Write(System.Text.Encoding.ASCII.GetBytes("WAVEfmt ")); w.Write(16); w.Write((short)1); w.Write((short)ch);
    w.Write(targetRate); w.Write(targetRate * ch * 2); w.Write((short)(ch * 2)); w.Write((short)16);
    w.Write(System.Text.Encoding.ASCII.GetBytes("data")); w.Write(frames * ch * 2);
    for (int f = 0; f < frames; f++) for (int c = 0; c < ch; c++) {
      int a = BitConverter.ToInt16(src, dataOff + ((2 * f) * ch + c) * 2);
      int b = BitConverter.ToInt16(src, dataOff + ((2 * f + 1) * ch + c) * 2);
      w.Write((short)((a + b) / 2));
    }
    w.Flush();
    return ms.ToArray();
  }
}
'@

$root = Split-Path -Parent $PSScriptRoot

function Shrink-Png([string]$path, [double]$scale) {
  $img = [System.Drawing.Image]::FromFile($path)
  try {
    $w = [math]::Max(1, [int][math]::Round($img.Width * $scale)); $h = [math]::Max(1, [int][math]::Round($img.Height * $scale))
    $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'
    $attr = New-Object System.Drawing.Imaging.ImageAttributes
    $attr.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
    $g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, $w, $h), 0, 0, $img.Width, $img.Height, [System.Drawing.GraphicsUnit]::Pixel, $attr)
    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    return $ms.ToArray()
  } finally { $img.Dispose() }
}

$mimes = @{ '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.wav' = 'audio/wav' }
$data = [ordered]@{}
$assetDir = Join-Path $root 'assets'
foreach ($f in Get-ChildItem $assetDir -Recurse -File | Where-Object { $mimes.ContainsKey($_.Extension.ToLower()) }) {
  $rel = 'assets/' + $f.FullName.Substring($assetDir.Length + 1).Replace('\', '/')
  $dir = $f.Directory.Name
  if ($dir -eq 'chars' -or $dir -eq 'weapons') { $bytes = Shrink-Png $f.FullName $PartScale }
  elseif ($dir -eq 'audio') { $bytes = [Wav]::Downsample([IO.File]::ReadAllBytes($f.FullName), $AudioRate) }
  else { $bytes = [IO.File]::ReadAllBytes($f.FullName) }
  $data[$rel] = 'data:' + $mimes[$f.Extension.ToLower()] + ';base64,' + [Convert]::ToBase64String($bytes)
}

$sb = New-Object System.Text.StringBuilder
[void]$sb.Append('window.ASSET_DATA={')
$first = $true
foreach ($k in $data.Keys) {
  if (-not $first) { [void]$sb.Append(",`n") }
  [void]$sb.Append('"' + $k + '":"' + $data[$k] + '"')
  $first = $false
}
[void]$sb.Append('};')
$assetJs = $sb.ToString()

function Embed-Paths([string]$text, [string]$prefix) {
  return [regex]::Replace($text, [regex]::Escape($prefix) + '(assets/[A-Za-z0-9_\-./]+\.(?:png|jpg|wav))', {
    param($m)
    $p = $m.Groups[1].Value
    if ($data.Contains($p)) { return $data[$p] } else { return $m.Value }
  })
}

$utf8 = New-Object System.Text.UTF8Encoding $false
$css = [IO.File]::ReadAllText((Join-Path $root 'css\style.css'), $utf8)
$css = Embed-Paths $css '../'
if (-not $Artifact) {
  $font = 'data:font/ttf;base64,' + [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $root 'assets\fonts\ONEMobilePOP.ttf')))
  $css = $css.Replace('url("../assets/fonts/ONEMobilePOP.ttf")', 'url("' + $font + '")')
} else {
$css = [regex]::Replace($css, '@font-face\s*\{[^}]*\}', '')
$css += @'

/* Shared build: the viewer pads :root for the phone's safe areas, so the app fills the body. */
html, body { height: 100%; }
body {
  padding-left: max(16px, env(safe-area-inset-left, 0px));
  padding-right: max(16px, env(safe-area-inset-right, 0px));
  background: #0d0f22;
}
#app { height: 100%; }
#topbar { padding-top: 6px; }
#nav { padding-bottom: 6px; }
'@
}

$html = [IO.File]::ReadAllText((Join-Path $root 'index.html'), $utf8)
$bodyStart = $html.IndexOf('<body>') + '<body>'.Length
$bodyEnd = $html.IndexOf('<script src=')
$body = Embed-Paths $html.Substring($bodyStart, $bodyEnd - $bodyStart).Trim() ''

$page = New-Object System.Text.StringBuilder
if ($Artifact) {
  [void]$page.AppendLine('<title>방진 돌격대</title>')
  [void]$page.AppendLine('<meta name="claude:viewport-fit-sides" content="cover">')
  [void]$page.AppendLine('<meta name="theme-color" content="#1b1e35">')
  [void]$page.AppendLine('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jua&display=swap">')
} else {
  # Same head as index.html, with the icon embedded and no external requests.
  $head = $html.Substring(0, $html.IndexOf('<body>'))
  $head = [regex]::Replace($head, '\s*<link rel="stylesheet"[^>]*>', '')
  $head = $head.Replace('href="assets/ui/equipment-helmet.png"', 'href="' + $data['assets/ui/equipment-helmet.png'] + '"')
  [void]$page.AppendLine($head.TrimEnd().Replace('</head>', '<style>' + $css + '</style>' + "`n</head>"))
  [void]$page.AppendLine('<body>')
}
if ($Artifact) { [void]$page.AppendLine('<style>' + $css + '</style>') }
[void]$page.AppendLine($body)
[void]$page.AppendLine('<script>' + $assetJs + '</script>')
foreach ($js in 'manifest', 'data', 'engine', 'battle', 'ui', 'main') {
  $code = [IO.File]::ReadAllText((Join-Path $root "js\$js.js"), $utf8)
  if ($code -match '</script') { throw "$js.js contains a closing script tag" }
  [void]$page.AppendLine('<script>' + $code + '</script>')
}
if (-not $Artifact) { [void]$page.AppendLine('</body>'); [void]$page.AppendLine('</html>') }
New-Item -ItemType Directory -Force (Split-Path -Parent $Out) | Out-Null
[IO.File]::WriteAllText($Out, $page.ToString(), $utf8)
"{0}: {1:N2} MB, {2} embedded files" -f $Out, ((Get-Item $Out).Length / 1MB), $data.Count
