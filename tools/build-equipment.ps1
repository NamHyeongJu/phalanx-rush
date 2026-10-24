# Imports forge-clone-2's equipment system: the player wardrobe (which item shows which
# body/helmet/weapon sprite), the item catalog with Korean names, base stats, dice-level
# odds, item level brackets and option ranges. Writes js/equipment.js and copies the
# sprites, item icons and dice face symbols it needs into assets/.
param(
  [string]$Src = "C:\Git\forge-clone-2\Assets\_Project",
  [string]$Dst = (Split-Path -Parent $PSScriptRoot),
  [double]$PartScale = 0.6
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$inv = [Globalization.CultureInfo]::InvariantCulture
$out = Join-Path $Dst "assets"
foreach ($d in "parts", "equip", "dice") { New-Item -ItemType Directory -Force (Join-Path $out $d) | Out-Null }

function Save-Image([System.Drawing.Image]$img, [string]$to, [int]$w, [int]$h, [int[]]$crop = $null, $attr = $null) {
  if (-not $crop) { $crop = @(0, 0, $img.Width, $img.Height) }
  $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = "HighQualityBicubic"; $g.PixelOffsetMode = "HighQuality"
  if (-not $attr) { $attr = New-Object System.Drawing.Imaging.ImageAttributes }
  $attr.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
  $g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, $w, $h), $crop[0], $crop[1], $crop[2], $crop[3], [System.Drawing.GraphicsUnit]::Pixel, $attr)
  $g.Dispose()
  $bmp.Save($to, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

function Num([string]$s) { [double]::Parse($s, $inv) }
function Js([string]$s) { '"' + $s.Replace('\', '\\').Replace('"', '\"') + '"' }

# ---------- wardrobe ----------
$asset = [IO.File]::ReadAllText((Join-Path $Src "Art\Characters\Sets\player-start-v1.asset"))
function Section($name, $next) {
  $i = $asset.IndexOf("  ${name}:"); $j = if ($next) { $asset.IndexOf("  ${next}:", $i) } else { -1 }
  if ($j -lt 0) { $j = $asset.Length }
  $asset.Substring($i, $j - $i)
}
$armors = [regex]::Matches((Section 'Armors' 'Helmets'), '- Tier: (\d+)\s+ItemIndex: (\d+)\s+Body: (\S*)\s+ArmLeft: (\S*)\s+ArmRight: (\S*)\s+HandLeft: (\S*)\s+HandRight: (\S*)')
$helmets = [regex]::Matches((Section 'Helmets' 'ItemWeapons'), '- Tier: (\d+)\s+ItemIndex: (\d+)\s+Hair: (\S*)')
$itemWeapons = [regex]::Matches((Section 'ItemWeapons' $null), '- Tier: (\d+)\s+ItemIndex: (\d+)\s+LeftHand: (\d)\s+Label: (\S*)\s+OffHandLabel: ?(\S*)\s+Scale: ([\d.]+)')
$shapeWeapons = [regex]::Matches((Section 'Weapons' 'WeaponProportions'), 'Part: (\S+)\s+Shape: (\d+)\s+LeftHand: (\d)\s+Label: (\S+)')

# Soldier defaults: bare recruit outfit plus the formation's own spear, bow and shield.
$defaults = [ordered]@{ body = 'torso-male'; armL = 'arm-left'; armR = 'arm-right'; face = 'handmade-face-01'; spear = 'bronze-weapon-02'; bow = 'bronze-weapon-07'; shield = 'roman-shield' }
$labels = New-Object System.Collections.Generic.HashSet[string]
foreach ($v in $defaults.Values) { [void]$labels.Add($v) }
foreach ($m in $armors) { foreach ($k in 3..7) { [void]$labels.Add($m.Groups[$k].Value) } }
foreach ($m in $helmets) { [void]$labels.Add($m.Groups[3].Value) }
foreach ($m in $itemWeapons) { [void]$labels.Add($m.Groups[4].Value); if ($m.Groups[5].Value) { [void]$labels.Add($m.Groups[5].Value) } }
foreach ($m in $shapeWeapons) { [void]$labels.Add($m.Groups[4].Value) }
[void]$labels.Remove('None'); [void]$labels.Remove('')

# Sprite files by name; set parts win over the generic reference parts of the same name.
$files = @{}
$charDir = Join-Path $Src "Art\Characters"
foreach ($f in Get-ChildItem $charDir -Recurse -Filter *.png | Sort-Object { if ($_.FullName -like '*\Sets\*') { 0 } else { 1 } }) {
  if (-not $files.ContainsKey($f.BaseName)) { $files[$f.BaseName] = $f.FullName }
}

$partJson = New-Object System.Collections.Generic.List[string]
foreach ($label in ($labels | Sort-Object)) {
  $png = $files[$label]
  if (-not $png) { throw "Missing sprite for $label" }
  $meta = [IO.File]::ReadAllText("$png.meta")
  $m = [regex]::Match($meta, "spritePivot: \{x: ([-\d.eE]+), y: ([-\d.eE]+)\}")
  $img = [System.Drawing.Image]::FromFile($png)
  try {
    $w = $img.Width; $h = $img.Height
    Save-Image $img (Join-Path $out "parts\$label.png") ([math]::Max(1, [int][math]::Round($w * $PartScale))) ([math]::Max(1, [int][math]::Round($h * $PartScale)))
  } finally { $img.Dispose() }
  $px = [math]::Round((Num $m.Groups[1].Value) * $w, 2); $py = [math]::Round((1 - (Num $m.Groups[2].Value)) * $h, 2)
  $partJson.Add((Js $label) + ':{"f":"assets/parts/' + $label + '.png","w":' + $w + ',"h":' + $h + ',"px":' + $px.ToString($inv) + ',"py":' + $py.ToString($inv) + '}')
}

$armorJson = foreach ($m in $armors) { (Js ($m.Groups[1].Value + ':' + $m.Groups[2].Value)) + ':[' + (($m.Groups[3..7] | ForEach-Object { Js $_.Value }) -join ',') + ']' }
$helmetJson = foreach ($m in $helmets) { (Js ($m.Groups[1].Value + ':' + $m.Groups[2].Value)) + ':' + (Js $m.Groups[3].Value) }
$itemWeaponJson = foreach ($m in $itemWeapons) { (Js ($m.Groups[1].Value + ':' + $m.Groups[2].Value)) + ':[' + (Js $m.Groups[4].Value) + ',' + $m.Groups[3].Value + ',' + (Js $m.Groups[5].Value) + ',' + $m.Groups[6].Value + ']' }
$shapeJson = foreach ($m in $shapeWeapons) { (Js ($m.Groups[1].Value + ':' + $m.Groups[2].Value)) + ':[' + (Js $m.Groups[4].Value) + ',' + $m.Groups[3].Value + ']' }

# ---------- catalog, names, icons ----------
$names = @{}
foreach ($r in Import-Csv (Join-Path $Src "Data\Charts\Language\Language_ko.csv") -Encoding UTF8) { $names[$r.Key] = $r.Value }
$ui = @{}
foreach ($r in Import-Csv (Join-Path $Src "Data\Interface_ko.csv") -Encoding UTF8) { $ui[$r.Key] = $r.Value }
$catalogJson = New-Object System.Collections.Generic.List[string]
foreach ($r in Import-Csv (Join-Path $Src "Data\Charts\EquipmentCatalog.csv")) {
  $icon = Join-Path $Src ($r.IconPath -replace '^Assets/_Project/', '' -replace '/', '\')
  $dstIcon = Join-Path $out "equip\$($r.IconId).png"
  if (-not (Test-Path $dstIcon)) {
    $img = [System.Drawing.Image]::FromFile($icon)
    try { Save-Image $img $dstIcon 160 160 } finally { $img.Dispose() }
  }
  $name = if ($names.ContainsKey($r.NameKey)) { $names[$r.NameKey] } else { $r.NameKey }
  $catalogJson.Add('[' + $r.Age + ',' + (Js $r.Part) + ',' + $r.ItemIndex + ',' + $r.BalanceItemIndex + ',' + $r.Shape + ',' + (Js $name) + ',' + (Js $r.IconId) + ']')
}

# Base stats per age / item type / balance index (before the 1.5 x 10 combat scale).
$stats = @{}
foreach ($r in Import-Csv (Join-Path $Src "Data\Charts\003_Item_Base_Stats.csv")) {
  if ([int]$r.Age -gt 9) { continue }
  $key = "$($r.Age):$($r.ItemType):$($r.ItemIndex)"
  if (-not $stats.ContainsKey($key)) { $stats[$key] = @(0.0, 0.0) }
  if ($r.StatType -eq 'Damage') { $stats[$key][0] += (Num $r.Value) } elseif ($r.StatType -eq 'Health') { $stats[$key][1] += (Num $r.Value) }
}
$statJson = foreach ($k in ($stats.Keys | Sort-Object)) { (Js $k) + ':[' + $stats[$k][0].ToString($inv) + ',' + $stats[$k][1].ToString($inv) + ']' }

$odds = foreach ($r in Import-Csv (Join-Path $Src "Data\Charts\004_Item_Drop_Chances.csv")) {
  '[' + ((0..9 | ForEach-Object { [math]::Round((Num $r."Age$_"), 4).ToString($inv) }) -join ',') + ']'
}
$brackets = foreach ($r in Import-Csv (Join-Path $Src "Data\Charts\005_Item_Level_Brackets.csv")) { '[' + $r.LowerRange + ',' + $r.UpperRange + ']' }

$optionKeys = [ordered]@{ CRITICAL_CHANCE = 'CriticalChance'; CRITICAL_DAMAGE = 'CriticalMulti'; BLOCK_CHANCE = 'BlockChance'; HEALTH_REGENERATION = 'HealthRegen';
  LIFE_STEAL = 'LifeSteal'; DOUBLE_CHANCE = 'DoubleDamageChance'; DAMAGE = 'DamageMulti'; MELEE_DAMAGE = 'MeleeDamageMulti'; RANGED_DAMAGE = 'RangedDamageMulti';
  ATTACK_SPEED = 'AttackSpeed'; SKILL_DAMAGE = 'SkillDamageMulti'; SKILL_COOLDOWN = 'SkillCooldownMulti'; HEALTH = 'HealthMulti' }
$ranges = @{}
foreach ($r in Import-Csv (Join-Path $Src "Data\Charts\007_Secondary_Stats.csv")) { if (-not $ranges.ContainsKey($r.ConfigKey)) { $ranges[$r.ConfigKey] = @($r.LowerRange, $r.UpperRange) } }
$optionJson = foreach ($k in $optionKeys.Keys) {
  $range = $ranges[$optionKeys[$k]]
  $label = if ($ui.ContainsKey("option_$k")) { $ui["option_$k"] } else { $k }
  (Js $k) + ':[' + $range[0] + ',' + $range[1] + ',' + (Js $label) + ']'
}

# ---------- dice face symbols (sword, helmet, armor / gloves, boot, ring), ivory on clear ----------
$mask = [System.Drawing.Image]::FromFile((Join-Path $Src "Art\ForgeDice\EngravingMask.png"))
try {
  $cm = New-Object System.Drawing.Imaging.ColorMatrix
  $cm.Matrix00 = 0; $cm.Matrix11 = 0; $cm.Matrix22 = 0; $cm.Matrix33 = 0
  $cm.Matrix03 = 1                     # alpha <- red channel (white symbol on black)
  $cm.Matrix40 = 1.0; $cm.Matrix41 = 0.95; $cm.Matrix42 = 0.82
  for ($i = 0; $i -lt 6; $i++) {
    $attr = New-Object System.Drawing.Imaging.ImageAttributes
    $attr.SetColorMatrix($cm)
    $crop = @((($i % 3) * 512), ([int][math]::Floor($i / 3) * 512), 512, 512)
    Save-Image $mask (Join-Path $out "dice\face-$i.png") 160 160 $crop $attr
  }
} finally { $mask.Dispose() }
foreach ($n in "forge-token", "mount-slot") {
  $img = [System.Drawing.Image]::FromFile((Join-Path $Src "Art\UI\$n.png"))
  try { Save-Image $img (Join-Path $out "ui\$n.png") 160 ([int](160 * $img.Height / $img.Width)) } finally { $img.Dispose() }
}

$js = "// Generated by tools/build-equipment.ps1 from forge-clone-2 - do not edit by hand.`n" +
"window.EQUIP = {`n" +
"  defaults: {" + (($defaults.Keys | ForEach-Object { $_ + ':' + (Js $defaults[$_]) }) -join ',') + "},`n" +
"  parts: {" + ($partJson -join ",`n    ") + "},`n" +
"  armors: {" + ($armorJson -join ',') + "},`n" +
"  helmets: {" + ($helmetJson -join ',') + "},`n" +
"  itemWeapons: {" + ($itemWeaponJson -join ',') + "},`n" +
"  shapeWeapons: {" + ($shapeJson -join ',') + "},`n" +
"  // [age, part, itemIndex, balanceIndex, shape, name, icon]`n" +
"  catalog: [" + ($catalogJson -join ",`n    ") + "],`n" +
"  stats: {" + ($statJson -join ',') + "},`n" +
"  odds: [" + ($odds -join ",`n    ") + "],`n" +
"  brackets: [" + ($brackets -join ',') + "],`n" +
"  options: {" + ($optionJson -join ',') + "}`n};`n"
[IO.File]::WriteAllText((Join-Path $Dst "js\equipment.js"), $js, (New-Object System.Text.UTF8Encoding $false))
"parts=$($partJson.Count) catalog=$($catalogJson.Count) stats=$($stats.Count) odds=$(@($odds).Count) brackets=$(@($brackets).Count)"
