param([Parameter(Mandatory)][string]$LegacyOutput, [string]$FixtureDirectory, [switch]$AllSelectedOnly)
$ErrorActionPreference = 'Stop'
$LegacyOutput = [IO.Path]::GetFullPath($LegacyOutput)
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$reports = Join-Path $project 'src\api\src\main\resources\employee-print'
if ($FixtureDirectory) { $reports = [IO.Path]::GetFullPath($FixtureDirectory) }
$dataset = Get-Content -Raw -Encoding UTF8 (Join-Path $reports 'roster.json') | ConvertFrom-Json
$temp = Join-Path ([IO.Path]::GetTempPath()) ('employee-reports-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($temp)
$exe = Join-Path $temp 'NativePreview.exe'
$refs = @('REPORT','DevExpress.XtraReports.v23.1','DevExpress.Printing.v23.1.Core','DevExpress.Data.v23.1','DevExpress.Utils.v23.1','DevExpress.Drawing.v23.1','DevExpress.XtraEditors.v23.1','DevExpress.XtraBars.v23.1','DevExpress.XtraPrinting.v23.1') | ForEach-Object { "/r:$(Join-Path $LegacyOutput "$_.dll")" }
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /codepage:65001 "/out:$exe" $refs (Join-Path $PSScriptRoot 'NativePreview.cs')
if ($LASTEXITCODE -ne 0) { throw 'Report harness did not compile' }
foreach ($plant in $dataset.plants) {
    $rows = @($dataset.employees | Where-Object plant -eq $plant.code)
    if ($rows.Count -gt 24 -or (!$AllSelectedOnly -and $rows.Count -gt 8)) { throw 'Use a bounded verification dataset' }
    $last = (1 -shl $rows.Count) - 1
    $first = if ($AllSelectedOnly) { $last } else { 1 }
    for ($mask = [Math]::Max(1,$first); $mask -le $last; $mask++) {
        $lines = @()
        $ids = @()
        for ($i = 0; $i -lt $rows.Count; $i++) {
            if ($mask -band (1 -shl $i)) {
                $row = $rows[$i]
                $ids += $row.id
                $lines += (@($row.id,$row.name,$plant.name,$row.department,$row.departmentName,'Y') -join [char]9)
            }
        }
        $inputFile = Join-Path $temp 'rows.tsv'
        [IO.File]::WriteAllLines($inputFile, [string[]]$lines, [Text.UTF8Encoding]::new($false))
        foreach ($form in 'QR','BARCODE') {
            $base = Join-Path $reports ($plant.code + '_' + ($ids -join '_') + '_' + $form)
            & $exe $LegacyOutput $form $inputFile ($base + '.png')
            if ($LASTEXITCODE -ne 0) { throw 'Original report render failed' }
        }
    }
}
