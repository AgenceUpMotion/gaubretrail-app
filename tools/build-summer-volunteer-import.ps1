param(
  [string]$Workbook = 'Bénévoles été 2026.xlsx',
  [string]$Output = 'imports/benevoles-ete-2026.json'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Read-XlsxSheet([string]$path, [int]$sheetNumber) {
  $zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $path).Path)
  try {
    $shared = @()
    $entry = $zip.Entries | Where-Object FullName -eq 'xl/sharedStrings.xml'
    if ($entry) {
      $reader = New-Object IO.StreamReader($entry.Open())
      [xml]$xml = $reader.ReadToEnd()
      $reader.Close()
      foreach ($item in $xml.sst.si) { $shared += [string]$item.InnerText }
    }
    $entry = $zip.Entries | Where-Object FullName -eq ("xl/worksheets/sheet{0}.xml" -f $sheetNumber)
    $reader = New-Object IO.StreamReader($entry.Open())
    [xml]$sheet = $reader.ReadToEnd()
    $reader.Close()
    foreach ($row in $sheet.worksheet.sheetData.row) {
      $values = @{}
      foreach ($cell in $row.c) {
        $column = $cell.r -replace '\d', ''
        $value = if ($cell.t -eq 's') { $shared[[int]$cell.v] } elseif ($cell.t -eq 'inlineStr') { [string]$cell.is.InnerText } elseif ($cell.v) { [string]$cell.v } else { '' }
        $values[$column] = ([string]$value).Trim()
      }
      [pscustomobject]@{ Row = [int]$row.r; Cells = $values }
    }
  } finally { $zip.Dispose() }
}

function Normalize([string]$value) {
  $decomposed = ([string]$value).Normalize([Text.NormalizationForm]::FormD)
  $chars = $decomposed.ToCharArray() | Where-Object { [Globalization.CharUnicodeInfo]::GetUnicodeCategory($_) -ne [Globalization.UnicodeCategory]::NonSpacingMark }
  ((-join $chars).ToLowerInvariant() -replace '[^a-z0-9]+', ' ').Trim()
}

function Slug([string]$value) { (Normalize $value) -replace ' ', '-' }
function Distinct-Lines($lines) { @($lines | Where-Object { $_ } | Select-Object -Unique) }
function Format-Time([int]$hour, [string]$minute) { '{0:d2}:{1:d2}' -f $hour, $(if ($minute) { [int]$minute } else { 0 }) }
function Parse-TimeRange([string]$value) {
  $clean = ([string]$value).Replace([char]0xA0, ' ').Trim()
  if ($clean -match '(?i)(\d{1,2})h(?:([0-5]\d))?\s*-\s*(\d{1,2})h(?:([0-5]\d))?') {
    return @{ start = Format-Time ([int]$matches[1]) $matches[2]; end = Format-Time ([int]$matches[3]) $matches[4]; label = $clean }
  }
  @{ label = $(if ($clean) { $clean } else { 'Horaire à préciser' }) }
}

$roster = @(Read-XlsxSheet $Workbook 2 | Where-Object { $_.Row -gt 1 -and $_.Cells.A -and $_.Cells.B })
$allocation = @(Read-XlsxSheet $Workbook 3 | Where-Object { $_.Row -gt 1 -and $_.Cells.A -and $_.Cells.B })
$people = [ordered]@{}

function Add-Person($row, [string]$source) {
  $c = $row.Cells
  $key = (Normalize ("{0} {1}" -f $c.A, $c.B))
  $phoneDigits = ([string]$c.D) -replace '\D',''
  if ($phoneDigits) {
    $samePersonKey = $people.Keys | Where-Object { (Normalize $people[$_].firstName) -eq (Normalize $c.B) -and (([string]$people[$_].phone -replace '\D','') -eq $phoneDigits) } | Select-Object -First 1
    if ($samePersonKey) { $key = $samePersonKey }
  }
  if (-not $people.Contains($key)) {
    $people[$key] = [ordered]@{
      id = 'volunteer-summer-2026-' + (Slug ("{0}-{1}" -f $c.B, $c.A))
      firstName = $c.B.Trim()
      lastName = $c.A.Trim().ToUpperInvariant()
      phone = ''
      email = ''
      notes = @()
      active = $true
      organizationMember = $false
      publicVisible = $false
      history = @()
    }
  }
  $person = $people[$key]
  if ($c.D -and -not $person.phone) { $person.phone = $c.D }
  elseif ($c.D -and $person.phone -and $person.phone -ne $c.D) { $person.notes += "Téléphone différent dans $source : $($c.D)" }
  if ($c.C -match '@' -and -not $person.email) { $person.email = $c.C.ToLowerInvariant() }
  elseif ($c.C -and $c.C -notmatch '@') { $person.notes += "Information : $($c.C)" }
  if ($c.E) { $person.notes += "Souhait / remarque : $($c.E)" }
  if ($source -eq 'liste') {
    $availability = @()
    if ($c.L) { $availability += 'samedi matin' }
    if ($c.M) { $availability += 'samedi après-midi' }
    if ($c.N) { $availability += 'dimanche matin' }
    if ($availability.Count) { $person.notes += 'Disponibilités : ' + ($availability -join ', ') }
  }
}

foreach ($row in $roster) { Add-Person $row 'liste' }
foreach ($row in $allocation) { Add-Person $row 'répartition' }

$state = Get-Content -LiteralPath 'data/organization.json' -Raw | ConvertFrom-Json
$posts = [ordered]@{}
foreach ($post in $state.posts | Where-Object editionId -eq 'summer-2026') { $posts[$post.id] = $post }

function Ensure-Post([string]$number, [string]$name, [string]$id, [string]$scheduleLabel) {
  if (-not $posts.Contains($id)) {
    $posts[$id] = [ordered]@{ id=$id; editionId='summer-2026'; number=$number; name=$name; required=0; description='Mission importée depuis la répartition Été 2026'; instructions=$(if($scheduleLabel){"Présence prévue : $scheduleLabel"}else{''}); courseIds=@(); publicVisible=$false }
  }
  $posts[$id]
}

function Resolve-Post([string]$mission, [string]$location, [string]$schedule) {
  $place = ([string]$location).Trim()
  $normalized = Normalize $place
  $code = ''
  if ($place -match '^\s*(14\s*[AB]|26[A-D]|7[AB]|[A-Y])\s*-') { $code = ($matches[1] -replace '\s','').ToUpperInvariant() }
  if ($code -eq '26A') { return Ensure-Post '26A-SM' 'Route de Saint Martin bas' 'summer-2026-post-26a-saint-martin' $schedule }
  if ($code -eq '26B') { return $posts['summer-2026-post-26a'] }
  if ($code -eq '26C') { return Ensure-Post '26C' "Rue de l'Aubretière" 'summer-2026-post-26c' $schedule }
  if ($code -eq '26D') { return Ensure-Post '26D' "L'Aubretière" 'summer-2026-post-26d' $schedule }
  if ($code) {
    $canonical = $code.ToLowerInvariant()
    $known = $posts["summer-2026-post-$canonical"]
    if ($known) { return $known }
  }
  $missionName = ([string]$mission).Trim()
  if ((Normalize $missionName) -eq 'bar 1') { return $posts['summer-2026-post-bar1'] }
  if ((Normalize $missionName) -eq 'bar 2') { return $posts['summer-2026-post-bar2'] }
  $suffix = ''
  if ((Normalize $missionName) -eq 'coureur balai' -and $place) { $suffix = ' ' + $place }
  $name = ($missionName + $suffix).Trim()
  $id = 'summer-2026-post-' + (Slug $name)
  $number = switch -Regex (Normalize $missionName) {
    '^consigne$' {'CONSIGNE';break}
    '^coureur balai$' {'BALAI-' + ((Normalize $place) -replace 'km','');break}
    '^installation$' {'INSTALLATION';break}
    '^ouvreur vtt$' {'OUVREUR-VTT';break}
    '^parking$' {'PARKING';break}
    '^ravito final$' {'RAVITO-FINAL';break}
    '^restauration$' {'RESTAURATION';break}
    '^retrait dossards$' {'DOSSARDS';break}
    '^retrait puces$' {'PUCES';break}
    default { 'MISSION-' + (Slug $name).ToUpperInvariant() }
  }
  Ensure-Post $number $name $id $schedule
}

$assignments = @()
$postCounts = @{}
foreach ($row in $allocation) {
  $c = $row.Cells
  if (-not $c.G) { continue }
  $person = $people[(Normalize ("{0} {1}" -f $c.A, $c.B))]
  $slots = @()
  if ($c.H -or $c.I) { $slots += ,@($c.H,$c.I,'1') }
  if ($c.J -or $c.K) { $slots += ,@($c.J,$c.K,'2') }
  if (-not $slots.Count) { $slots += ,@('','','1') }
  foreach ($slot in $slots) {
    $location = [string]$slot[0]
    $schedule = [string]$slot[1]
    if ($location -match '(?i)^\s*\d{1,2}h' -and -not $schedule) { $schedule=$location; $location='' }
    $post = Resolve-Post $c.G $location $schedule
    if (-not $post) { throw "Poste introuvable à la ligne $($row.Row): $($c.G) / $location" }
    $parsed = Parse-TimeRange $schedule
    $date = if (($parsed.label -match '(?i)samedi') -or (($c.M -or $c.N) -and -not $c.O)) { '2026-09-05' } else { '2026-09-06' }
    $assignment = [ordered]@{
      id = 'assignment-summer-2026-' + (Slug ("{0}-{1}-{2}" -f $person.id,$post.id,$slot[2]))
      volunteerId = $person.id
      postId = $post.id
      editionId = 'summer-2026'
      date = $date
      instructions = $(if ($location) { $location } else { $c.G })
      notes = 'Importé depuis la page Répartition bénévoles été 26.'
    }
    if ($parsed.start -and $parsed.end) { $assignment.start=$parsed.start; $assignment.end=$parsed.end }
    else { $assignment.scheduleLabel=$parsed.label }
    $assignments += $assignment
    $postCounts[$post.id] = 1 + [int]($postCounts[$post.id])
  }
}

foreach ($id in $postCounts.Keys) {
  $post = $posts[$id]
  if ($post.description -eq 'Mission importée depuis la répartition Été 2026') { $post.required = $postCounts[$id] }
}

$volunteers = @($people.Values | ForEach-Object { $_.notes = (Distinct-Lines $_.notes) -join "`n"; $_ })
$referencedPostIds = @($assignments.postId | Select-Object -Unique)
$outputData = [ordered]@{
  type = 'volunteer-plan'
  version = 1
  editionId = 'summer-2026'
  source = 'Bénévoles été 2026.xlsx · pages 2 et 3'
  volunteers = $volunteers
  posts = @($posts.Values | Where-Object { $referencedPostIds -contains $_.id })
  assignments = $assignments
}

$parent = Split-Path -Parent $Output
if ($parent -and -not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
$outputData | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Output -Encoding utf8
Write-Output ("{0} bénévoles, {1} postes référencés, {2} affectations" -f $volunteers.Count,$outputData.posts.Count,$assignments.Count)
