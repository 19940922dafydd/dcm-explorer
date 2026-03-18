@echo off
echo 初始化并构建 Windows EXE
echo ====================================

:: Install dependencies
pip install -r requirements.txt
pip install pyinstaller

:: Clean previous builds
rmdir /s /q build dist 2>nul
del /q *.spec 2>nul

echo 开始打包...
:: Package using PyInstaller
:: Note: Windows uses ";" as path separator in --add-data
pyinstaller --name "DCM资源管家" ^
            --windowed ^
            --noconfirm ^
            --clean ^
            --add-data "web;web" ^
            --add-data "requirements.txt;." ^
            main.py

echo ====================================
echo 打包完成！如果不报错，您的 EXE 文件已生成在 dist\DCM资源管家\ 目录内。
pause
