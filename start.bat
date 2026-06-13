@echo off
chcp 65001 >nul
echo ============================================
echo   マイプランナー 起動中...
echo ============================================
echo.

REM Try npx (Node.js) first — usually fastest
where npx >nul 2>&1
if %errorlevel% == 0 (
    echo [OK] Node.js が見つかりました
    echo [>>] http://localhost:8765 でサーバーを起動します
    echo      ブラウザが自動的に開きます。
    echo      終了するには Ctrl+C を押してください。
    echo.
    start "" http://localhost:8765
    npx serve -l 8765 .
    goto :end
)

REM Try Python
where python >nul 2>&1
if %errorlevel% == 0 (
    echo [OK] Python が見つかりました
    echo [>>] http://localhost:8765 でサーバーを起動します
    echo.
    start "" http://localhost:8765
    python -m http.server 8765
    goto :end
)

where python3 >nul 2>&1
if %errorlevel% == 0 (
    start "" http://localhost:8765
    python3 -m http.server 8765
    goto :end
)

echo [ERROR] Node.js も Python も見つかりませんでした。
echo.
echo 以下のいずれかをインストールしてください:
echo   Node.js: https://nodejs.org/  (推奨)
echo   Python : https://www.python.org/downloads/
echo.
pause

:end
