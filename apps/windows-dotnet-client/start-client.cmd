@echo off
setlocal
cd /d "%~dp0"
dotnet run --project FileAssistant.WinClient.csproj
