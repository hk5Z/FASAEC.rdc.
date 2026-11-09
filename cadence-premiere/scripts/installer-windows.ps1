# Cadence - installation pour l'utilisateur courant (Windows, Premiere Pro 2023 / CEP 11)
# Usage : double-cliquer sur installer.cmd (ou clic droit > Executer avec PowerShell)
param([switch]$SansModeDeveloppeur)
$ErrorActionPreference = 'Stop'

$source = Join-Path (Split-Path -Parent $PSScriptRoot) 'extension'
$dest   = Join-Path $env:APPDATA 'Adobe\CEP\extensions\fr.cadence.montage'

if (-not (Test-Path (Join-Path $source 'CSXS\manifest.xml'))) {
    throw "Dossier 'extension' introuvable a cote de ce script : $source"
}
if (Get-Process -Name 'Adobe Premiere Pro' -ErrorAction SilentlyContinue) {
    Write-Warning "Premiere Pro est ouvert : fermez-le, puis relancez-le apres l'installation."
}

if (Test-Path $dest) {
    Write-Host "Remplacement de l'installation existante : $dest"
    Remove-Item -LiteralPath $dest -Recurse -Force
}
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
Copy-Item -LiteralPath $source -Destination $dest -Recurse
Write-Host "Extension copiee dans : $dest"

if (-not $SansModeDeveloppeur) {
    # Extension non signee : CEP 11 (Premiere Pro 23.x) lit HKCU\Software\Adobe\CSXS.11
    $key = 'HKCU:\Software\Adobe\CSXS.11'
    New-Item -Path $key -Force | Out-Null
    New-ItemProperty -Path $key -Name 'PlayerDebugMode' -Value '1' -PropertyType String -Force | Out-Null
    Write-Host "Mode developpeur active : HKCU\Software\Adobe\CSXS.11\PlayerDebugMode = 1"
}

Write-Host ''
Write-Host 'Termine. Redemarrez Premiere Pro puis ouvrez : Fenetre > Extensions > Cadence - Montage rapide'
