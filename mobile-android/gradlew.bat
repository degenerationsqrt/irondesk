@echo off
setlocal
call "%~dp0..\android-health-connect\gradlew.bat" -p "%~dp0." %*
exit /b %ERRORLEVEL%
