@echo off
setlocal
cd /d "%~dp0..\.."
dotnet publish apps\windows-dotnet-client\FileAssistant.WinClient.csproj -c Release -r win-x64 --self-contained false -o dist\windows-client-win-x64
dotnet publish apps\windows-dotnet-client\FileAssistant.WinClient.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -o dist\windows-client-win-x64-self-contained
