# Copies the game resources this web game needs out of the Unity project,
# downsizes large UI art, slices icon sheets and writes js/manifest.js with
# per-part sizes and pivots (Unity pivot -> canvas top-left coordinates).
param(
  [string]$Src = "C:\Git\forge-clone-2\Assets\_Project",
  [string]$Dst = (Split-Path -Parent $PSScriptRoot)
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$art = Join-Path $Src "Art"
$out = Join-Path $Dst "assets"
foreach ($d in "chars", "weapons", "ui", "icons", "skills", "vfx", "bg", "audio", "fonts") {
  New-Item -ItemType Directory -Force (Join-Path $out $d) | Out-Null
}

function Save-Resized([string]$from, [string]$to, [int]$maxDim, [int[]]$crop = $null) {
  $img = [System.Drawing.Image]::FromFile($from)
  try {
    if ($crop) { $sx, $sy, $sw, $sh = $crop } else { $sx = 0; $sy = 0; $sw = $img.Width; $sh = $img.Height }
    $s = [math]::Min(1.0, $maxDim / [math]::Max($sw, $sh))
    $w = [math]::Max(1, [int][math]::Round($sw * $s)); $h = [math]::Max(1, [int][math]::Round($sh * $s))
    $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = "HighQualityBicubic"; $g.PixelOffsetMode = "HighQuality"; $g.CompositingQuality = "HighQuality"
    $attr = New-Object System.Drawing.Imaging.ImageAttributes
    $attr.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
    $g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, $w, $h), $sx, $sy, $sw, $sh, [System.Drawing.GraphicsUnit]::Pixel, $attr)
    $g.Dispose()
    if ($to -like "*.jpg") {
      $enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
      $ep = New-Object System.Drawing.Imaging.EncoderParameters 1
      $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 86L
      $bmp.Save($to, $enc, $ep)
    } else { $bmp.Save($to, [System.Drawing.Imaging.ImageFormat]::Png) }
    $bmp.Dispose()
  } finally { $img.Dispose() }
}

function Get-Pivot([string]$png) {
  $meta = Get-Content "$png.meta" -Raw
  $m = [regex]::Match($meta, "spritePivot: \{x: ([-\d.eE]+), y: ([-\d.eE]+)\}")
  $img = [System.Drawing.Image]::FromFile($png)
  $w = $img.Width; $h = $img.Height; $img.Dispose()
  $px = [double]::Parse($m.Groups[1].Value, [Globalization.CultureInfo]::InvariantCulture)
  $py = [double]::Parse($m.Groups[2].Value, [Globalization.CultureInfo]::InvariantCulture)
  return @{ w = $w; h = $h; px = [math]::Round($px * $w, 2); py = [math]::Round((1 - $py) * $h, 2) }
}

function Part-Json([string]$png, [string]$rel) {
  $p = Get-Pivot $png
  Copy-Item $png (Join-Path $out $rel) -Force
  $inv = [Globalization.CultureInfo]::InvariantCulture
  return '{"f":"assets/' + $rel.Replace('\', '/') + '","w":' + $p.w + ',"h":' + $p.h + ',"px":' + $p.px.ToString($inv) + ',"py":' + $p.py.ToString($inv) + '}'
}

# ---------- character sets ----------
$sets = @(
  "primitive-handmade-01-v1", "primitive-handmade-02-v1", "primitive-handmade-03-v1",
  "bronze-handmade-01-v1", "bronze-handmade-02-v1", "bronze-handmade-03-v1", "bronze-handmade-04-v1",
  "classical-handmade-01-v1", "classical-handmade-02-v1", "classical-handmade-03-v1", "classical-handmade-04-v1", "roman-legionary-v1", "gladiator-iron-v1",
  "medieval-handmade-01-v1", "medieval-handmade-02-v1", "medieval-handmade-03-v1", "medieval-handmade-04-v1", "medieval-handmade-05-v1", "medieval-handmade-06-v1", "medieval-surcoat-v1",
  "steam-knight-01-v1", "steam-knight-02-v1", "steam-knight-03-v1",
  "quantum-handmade-01-v1", "quantum-handmade-02-v1", "quantum-handmade-03-v1",
  "orc-monster-v1"
)
$slotPatterns = [ordered]@{
  body = "-body.png$"; head = "-head.png$"; helmet = "-helmet.png$"; hairBack = "-hair-back.png$"
  armL = "-arm-left.png$"; armR = "-arm-right.png$"; handL = "-hand-left.png$"; handR = "-hand-right.png$"
}
$setJson = @()
foreach ($set in $sets) {
  $dir = Join-Path $art "Characters\Sets\$set\Parts"
  $files = Get-ChildItem $dir -Filter *.png
  $entries = @()
  foreach ($slot in $slotPatterns.Keys) {
    $f = $files | Where-Object { $_.Name -match $slotPatterns[$slot] } | Select-Object -First 1
    if ($f) { $entries += ('"' + $slot + '":' + (Part-Json $f.FullName ("chars\" + $f.Name))) }
  }
  $setJson += ('"' + $set + '":{' + ($entries -join ",") + '}')
}

# Bare faces worn under helmets
$faces = @()
foreach ($i in 1..4) {
  $f = Join-Path $art "Characters\Heads\handmade-faces-v1\handmade-face-0$i.png"
  $faces += (Part-Json $f "chars\handmade-face-0$i.png")
}

# ---------- weapons ----------
$weapons = [ordered]@{
  dagger = "classical-handmade-01-v1\Parts\classical-weapon-02.png"
  bronzeSword = "bronze-handmade-01-v1\Parts\bronze-weapon-04.png"
  khopesh = "bronze-handmade-01-v1\Parts\bronze-weapon-03.png"
  gladius = "roman-legionary-v1\Parts\roman-gladius.png"
  longsword = "medieval-handmade-01-v1\Parts\medieval-weapon-02.png"
  scimitar = "medieval-handmade-01-v1\Parts\medieval-weapon-07.png"
  flameSword = "steam-knight-01-v1\Parts\steam-knight-weapon-03.png"
  quantumBlade = "quantum-handmade-01-v1\Parts\quantum-weapon-01.png"
  stoneSpear = "primitive-handmade-01-v1\Parts\primitive-weapon-03.png"
  bronzeSpear = "bronze-handmade-01-v1\Parts\bronze-weapon-02.png"
  pike = "classical-handmade-01-v1\Parts\classical-weapon-01.png"
  halberd = "exploration-handmade-01-v1\Parts\exploration-weapon-03.png"
  trident = "quantum-handmade-01-v1\Parts\quantum-weapon-02.png"
  stoneAxe = "primitive-handmade-01-v1\Parts\primitive-weapon-01.png"
  bronzeAxe = "bronze-handmade-01-v1\Parts\bronze-weapon-01.png"
  ironAxe = "classical-handmade-01-v1\Parts\classical-weapon-03.png"
  battleAxe = "medieval-handmade-01-v1\Parts\medieval-weapon-01.png"
  cleaver = "bronze-handmade-01-v1\Parts\bronze-weapon-05.png"
  quantumScythe = "quantum-handmade-01-v1\Parts\quantum-weapon-03.png"
  boneClub = "primitive-handmade-01-v1\Parts\primitive-weapon-02.png"
  spikedClub = "exploration-handmade-01-v1\Parts\exploration-weapon-06.png"
  bigClub = "primitive-barbarian-female-v1\Parts\barbarian-club.png"
  morningstar = "medieval-handmade-01-v1\Parts\medieval-weapon-03.png"
  shortBow = "primitive-handmade-01-v1\Parts\primitive-weapon-04.png"
  bronzeBow = "bronze-handmade-01-v1\Parts\bronze-weapon-07.png"
  longBow = "classical-handmade-01-v1\Parts\classical-weapon-05.png"
  warBow = "medieval-handmade-01-v1\Parts\medieval-weapon-05.png"
  crossbow = "medieval-handmade-01-v1\Parts\medieval-weapon-06.png"
  heavyCrossbow = "classical-handmade-01-v1\Parts\classical-weapon-06.png"
  flintlock = "exploration-handmade-01-v1\Parts\exploration-weapon-04.png"
  piratePistol = "pirate-01-v1\Parts\pirate-weapon-01.png"
  musket = "exploration-handmade-01-v1\Parts\exploration-weapon-05.png"
  blunderbuss = "pirate-01-v1\Parts\pirate-weapon-02.png"
  steamRifle = "steam-knight-01-v1\Parts\steam-knight-weapon-02.png"
  quantumRifle = "quantum-handmade-01-v1\Parts\quantum-weapon-05.png"
  staff = "witch-handmade-v1\Parts\witch-handmade-v1-weapon.png"
  rustySword = "pirate-01-v1\Parts\pirate-weapon-04.png"
  shield = "roman-legionary-v1\Parts\roman-shield.png"
}
$weaponJson = @()
foreach ($k in $weapons.Keys) {
  $f = Join-Path $art ("Characters\Sets\" + $weapons[$k])
  $weaponJson += ('"' + $k + '":' + (Part-Json $f ("weapons\" + [IO.Path]::GetFileName($f))))
}

# ---------- UI art (downsized) ----------
$ui = @{
  "currency-gold" = 128; "currency-gem" = 128; "close-button" = 128; "combat-power-small" = 128
  "menu-shop" = 160; "menu-growth" = 160; "menu-guild" = 160; "menu-dungeon" = 160; "menu-league" = 160; "menu-growth-hood" = 160
  "skill-auto-on" = 112; "skill-auto-off" = 112; "skill-slot-open" = 138; "skill-slot-locked" = 138; "skill-summon-ticket" = 160
  "mercenary-contract" = 200; "forge-card-back" = 185; "forge-crystal" = 256; "rank-flare" = 256; "reward-twinkle" = 90
  "rest-reward-chest" = 900; "tutorial-hand" = 160; "content-lock" = 128; "profile-default" = 128; "fantasy-skill-ring" = 128
  "equipment-helmet" = 160; "rank-dust" = 256; "rank-wave" = 256; "progress-pass-flare" = 256; "auto-forge" = 128
  "auto-forge-active" = 128; "skill-ascension-arrow" = 128; "rewarded-ad" = 160; "combat-power" = 160; "fantasy-paper" = 128
}
foreach ($k in $ui.Keys) { Save-Resized (Join-Path $art "UI\$k.png") (Join-Path $out "ui\$k.png") $ui[$k] }

# ---------- sheets ----------
function Slice-Sheet([string]$from, [int]$cols, [int]$rows, [string[]]$names, [string]$dir, [int]$size, [double]$inset = 0) {
  $img = [System.Drawing.Image]::FromFile($from); $W = $img.Width; $H = $img.Height; $img.Dispose()
  $cw = $W / $cols; $ch = $H / $rows
  $ix = $cw * $inset; $iy = $ch * $inset
  for ($i = 0; $i -lt $names.Count; $i++) {
    if (-not $names[$i]) { continue }
    $c = $i % $cols; $r = [math]::Floor($i / $cols)
    Save-Resized $from (Join-Path $out "$dir\$($names[$i]).png") $size @([int]($c * $cw + $ix), [int]($r * $ch + $iy), [int]($cw - 2 * $ix), [int]($ch - 2 * $iy))
  }
}
Slice-Sheet (Join-Path $art "UI\icons.png") 5 5 @(
  "coin", "hammer", "emerald", "potion", "plus", "scroll", "chest", "banner", "arrow-up", "fast-forward",
  "house", "swords", "dungeon", "paw", "book", "lock", "trophy", "ring", "necklace", "gloves",
  "boots", "belt", "anvil", "star", "cross") "icons" 128
Slice-Sheet (Join-Path $art "UI\skills.png") 4 3 @(
  "fireball", "ice-lance", "lightning", "arrow-rain", "hellfire", "star-nova", "crystal", "poison-bomb",
  "beast-claw", "meteor", "fire-wave", "sun-blessing") "skills" 192 0.035
Slice-Sheet (Join-Path $art "UI\skill-vfx.png") 4 4 @(
  "axe", "arrow", "cannonball", "powder-keg", "bolt", "train", "rocket", "plane",
  "drone", "stake", "zap", "ring", "sparkle", "dust", "streak", "explosion") "vfx" 160
Slice-Sheet (Join-Path $art "UI\skills-growth.png") 3 2 @("meat", "fist", "rage", "muscle", "crown-fist", "drone") "icons" 160 0.04

# ---------- VFX + backgrounds ----------
$vfx = @{ "StormCloudFlash" = 360; "StormCloudIdle" = 360; "OrbitalImpact\ImpactCrater" = 420; "OrbitalImpact\ImpactSmokeRing" = 420; "Cannon\CannonGas" = 360; "WarDrum\WarDrum" = 240; "WarDrum\DrumMallet" = 120 }
foreach ($k in $vfx.Keys) { Save-Resized (Join-Path $art "VFX\$k.png") (Join-Path $out ("vfx\" + [IO.Path]::GetFileName($k) + ".png")) $vfx[$k] }

Save-Resized (Join-Path $art "UI\character-preview-forest.png") (Join-Path $out "bg\forest.jpg") 1600
$eras = @{ "01-primitive" = "canyon"; "03-classical" = "classical"; "04-medieval" = "medieval"; "05-exploration" = "coast"; "02-bronze" = "nile" }
foreach ($k in $eras.Keys) { Save-Resized (Join-Path $art "Environments\Eras\$k\distant.png") (Join-Path $out "bg\$($eras[$k]).jpg") 1024 }

# ---------- audio + font ----------
$audio = "CombatSwing1", "CombatSwing2", "CombatSwing3", "CombatHit1", "CombatHit2", "CombatHit3", "CombatHit4", "CombatBow1", "CombatBow2",
"CombatCrossbow1", "CombatGun1", "CombatGun2", "CombatExplosion1", "CombatFlame1", "CombatCoin1", "CombatGrave1", "CombatLaser1",
"UiTap", "UiConfirm", "UiDeny", "UiReveal", "UiReward", "UiLevelUp", "UiCoins", "UiOpen", "UiClose", "UiChest", "UiPlayerLevelUp"
foreach ($a in $audio) { Copy-Item (Join-Path $Src "Audio\$a.wav") (Join-Path $out "audio\$a.wav") -Force }
Copy-Item (Join-Path $Src "Fonts\ONE Mobile POP.ttf") (Join-Path $out "fonts\ONEMobilePOP.ttf") -Force

# ---------- manifest ----------
$js = "// Generated by tools/build-assets.ps1 - do not edit by hand.`n" +
"window.MANIFEST = {`n" +
"  sets: {" + ($setJson -join ",`n    ") + "},`n" +
"  faces: [" + ($faces -join ",") + "],`n" +
"  weapons: {" + ($weaponJson -join ",`n    ") + "}`n};`n"
New-Item -ItemType Directory -Force (Join-Path $Dst "js") | Out-Null
[IO.File]::WriteAllText((Join-Path $Dst "js\manifest.js"), $js, (New-Object System.Text.UTF8Encoding $false))
"done: " + (Get-ChildItem $out -Recurse -File | Measure-Object -Property Length -Sum | ForEach-Object { "{0} files, {1:N1} MB" -f $_.Count, ($_.Sum / 1MB) })
