# 创建「拯救 DDL」桌面 / 开始菜单快捷方式。
# 先运行一次 node apps/desktop/scripts/start.mjs，确认短路径运行目录已生成。

$runtime = Join-Path $env:PUBLIC 'SaveDDL\app'
$app = Join-Path $runtime 'apps\desktop'
$target = Join-Path $app 'vendor\electron\electron.exe'
$icon = Join-Path $app 'assets\icon.ico'

if (-not (Test-Path $target)) {
    Write-Error "找不到 $target。请先运行：node apps/desktop/scripts/start.mjs"
    exit 1
}

$wshell = New-Object -ComObject WScript.Shell
$destinations = @(
    [Environment]::GetFolderPath('Desktop'),
    [Environment]::GetFolderPath('Programs')
)

foreach ($directory in $destinations) {
    $path = Join-Path $directory '拯救 DDL.lnk'
    $shortcut = $wshell.CreateShortcut($path)
    $shortcut.TargetPath = $target
    $shortcut.Arguments = '"' + $app + '"'
    $shortcut.WorkingDirectory = $app
    $shortcut.IconLocation = $icon
    $shortcut.Description = '拯救 DDL：截止时间收集与提醒'
    $shortcut.Save()
    Write-Output "created $path"
}