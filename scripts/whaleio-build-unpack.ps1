# whale-io 部署线：桌面端 build:unpack（发布清单换入-打包-恢复，异常也恢复）
$ErrorActionPreference = 'Stop'
Set-Location E:\WhaleIO\tmp\WeQ
$appPkg = 'apps\desktop\package.json'
$relPkg = 'apps\desktop\package.release.json'
$backup = 'apps\desktop\package.json.dev-backup'
try {
  node scripts/prepare-electron-builder-manifest.mjs
  Copy-Item $appPkg $backup -Force
  Copy-Item $relPkg $appPkg -Force
  Write-Host '=== 发布清单已换入，开始打包 ==='
  corepack pnpm --filter @weq/desktop exec electron-builder --dir 2>&1 | Select-Object -Last 20
  $code = $LASTEXITCODE
  Write-Host "BUILDER_EXIT=$code"
} finally {
  if (Test-Path $backup) {
    Copy-Item $backup $appPkg -Force
    Remove-Item $backup -Force
    Remove-Item $relPkg -Force -ErrorAction SilentlyContinue
    Write-Host '=== 开发清单已恢复 ==='
  }
}
