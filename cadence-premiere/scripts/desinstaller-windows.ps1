# Cadence - desinstallation (utilisateur courant)
# -DesactiverModeDeveloppeur supprime aussi PlayerDebugMode : cela desactive TOUTES les extensions CEP 11 non signees.
param([switch]$DesactiverModeDeveloppeur)
$ErrorActionPreference = 'Stop'

$dest = Join-Path $env:APPDATA 'Adobe\CEP\extensions\fr.cadence.montage'
if (Test-Path $dest) {
    Remove-Item -LiteralPath $dest -Recurse -Force
    Write-Host "Dossier supprime : $dest"
} else {
    Write-Host "Aucune installation trouvee dans : $dest"
}

if ($DesactiverModeDeveloppeur) {
    Remove-ItemProperty -Path 'HKCU:\Software\Adobe\CSXS.11' -Name 'PlayerDebugMode' -ErrorAction SilentlyContinue
    Write-Host 'PlayerDebugMode supprime de HKCU\Software\Adobe\CSXS.11'
}
Write-Host 'Redemarrez Premiere Pro pour terminer. Les fichiers rendus (dossiers Cadence_Rendus) sont conserves.'
